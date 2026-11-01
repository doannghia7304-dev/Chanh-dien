// Chánh Điện Tịnh Tâm — live server
// Runs on the streaming PC. Serves the overlay + control panel, listens to a TikTok LIVE room,
// keeps the list of seated viewers, generates Vietnamese voice lines with Edge TTS and pushes
// everything to the overlay over WebSocket.
//
//   cd live && npm install && node server.mjs        → http://localhost:3000/live/control.html
//
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { WebSocketServer } from 'ws';
import { MsEdgeTTS, OUTPUT_FORMAT } from 'msedge-tts';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');            // repo root: serves /assets, /live
const TTS_DIR = path.join(__dirname, 'tts');
fs.mkdirSync(TTS_DIR, { recursive: true });
for (const f of fs.readdirSync(TTS_DIR)) { try { fs.unlinkSync(path.join(TTS_DIR, f)); } catch {} }
const PORT = +process.env.PORT || 3000;

/* ------------------------------------------------------------------ state */
const settings = {
  title: 'Chánh Điện Tịnh Tâm',
  subtitle: 'Nam Mô A Di Đà Phật',
  voice: 'vi-VN-NamMinhNeural',      // or vi-VN-HoaiMyNeural
  pitch: -18,                        // Hz
  rate: -20,                         // %
  ttsFallback: false,                // every Edge TTS try failed: read the line with the offline Windows voice instead of skipping it
  greet: true,                       // welcome newly seated viewers by name (a few names per line, at most every 30 s)
  music: true, mo: true, moBpm: 52,
  autoChant: true, chantEveryMin: 3,
  sessionMin: 60,                    // countdown of one "khóa lễ"; when it ends: bell + chant, then it restarts
  seatMode: 'auto',                  // auto (200) | 50 | 100 | 150 | 200
  frameSize: 90,                     // % of the window the 9:16 stage fills; phones crop the edges of a LIVE, so leave a margin
  bustle: 2,                         // people getting up to bow before the altar: 0 none, 1 a few, 2 lively, 3 busy
  peopleSize: 120,                   // % size of the worshippers against their seat spacing: bigger reads as a fuller hall
  procession: true,                  // monks walk in procession down and up the side aisles with each periodic chant
  likeStep: 1000,                    // every this many hearts: lotus rain (0 = off)
  teach: true,                       // a comment "lời dạy" gets a short teaching on the banner, read out when the voice is free
  dedicate: true,                    // at the end of a session the merit is dedicated to the people present, by name
  giftHint: true,                    // after each periodic chant, a pointer to TikTok's gift button for a few seconds
  recite: true,                      // comments "Nam mô ..." count toward a shared 108 (bell and a new round at 108)
  quizEveryMin: 5,                   // a Buddhism quiz (comment A, B or C) every this many minutes (0 = off)
  thankSocial: true,                 // new followers and sharers are thanked by name
  candles: true,                     // "thắp nến" lights a candle with the viewer's name for the rest of the session
  badges: true,                      // lotus badges on the name tag for staying 10 / 30 / 60 minutes
  joinOnEnter: false,               // also seat viewers who only enter the room
  gifts: { readAll: true, minDiamonds: 1 },
};
const viewers = new Map();           // id -> { id, name, skin, avatar, coins, joinedAt, lastAt, lastText, lastTextAt, demo }
const startedAt = Date.now();
let tiktok = null, tiktokState = { status: 'idle', uniqueId: '', error: '' };
const log = [];
function addLog(s){ const line = `[${new Date().toLocaleTimeString('vi-VN')}] ${s}`; log.push(line); if (log.length > 300) log.shift(); broadcast({ t:'log', line }, 'control'); console.log(line); }

const MAX_SEATS = 200;
function capacity(){ return settings.seatMode === 'auto' ? MAX_SEATS : +settings.seatMode; }

/* offerings: every gift falls in one of three tiers by its per-unit diamond value. The overlay legend shows the gift for
   each: Rose (1 coin) is Dâng hương, Four-leaf clover (10) is Lễ Phật, the 100-coin heart is Hoa sen. */
const stats = { incense: 0, bow: 0, lotus: 0, likes: 0 };
const OFFER_LABEL = { incense: 'Dâng hương', bow: 'Lễ Phật', lotus: 'Hoa sen' };
const offerKind = dia => dia >= 100 ? 'lotus' : dia >= 10 ? 'bow' : 'incense';
const donors = new Map();            // id -> { name, coins }; outlives the seat so the board survives being bumped
let lastOffer = null;                // { name, label }
const topDonors = () => [...donors.values()].sort((a, b) => b.coins - a.coins).slice(0, 3);
let statsTimer = null;               // likes arrive in bursts; push counters at most twice a second
function pushStats(){ if (statsTimer) return; statsTimer = setTimeout(() => { statsTimer = null; broadcast({ t:'stats', stats, likeGoal }); }, 500); }
// Likes goal: every likeStep hearts the overlay rains lotus petals and the voice thanks the room. Hearts are free, so this
// is the goal everyone can help with, and TikTok counts them when it picks lives to recommend.
const nextGoal = () => settings.likeStep ? (Math.floor(stats.likes / settings.likeStep) + 1) * settings.likeStep : 0;
let likeGoal = nextGoal();
function addLikes(n){
  stats.likes += n; pushStats();
  if (!likeGoal || stats.likes < likeGoal) return;
  const goal = Math.floor(stats.likes / settings.likeStep) * settings.likeStep; likeGoal = nextGoal();   // a burst past several goals: one rain, the highest
  broadcast({ t:'likegoal', goal, next: likeGoal }); addLog(`💗 Đủ ${goal} tim: mưa hoa sen`);
  say(`Đại chúng đã thả đủ ${goal} tim. Nguyện hoa sen nở khắp mười phương, ai nấy thân tâm an lạc. Nam mô A Di Đà Phật.`, { tag:'goal' });
}

let sessionEndsAt = Date.now() + settings.sessionMin * 60_000;
function resetSession(){ sessionEndsAt = Date.now() + settings.sessionMin * 60_000; broadcast({ t:'session', endsAt: sessionEndsAt }); }
setInterval(() => { if (Date.now() >= sessionEndsAt){ resetSession(); broadcast({ t:'bell' }); chant(); if (settings.dedicate) dedicate(); clearCandles(); addLog('🔔 Hết khóa lễ, bắt đầu khóa mới'); } }, 1000);

/* skins: sprites that exist in /assets. Walking strips exist for man / woman / granny. */
// A comment changes the outfit only when it IS the keyword (≤ 3 words), so "Nam mô A Di Đà Phật" never reads as "nam".
const SKIN_WORDS = [
  ['master', ['cao tăng','cao tang']], ['monk', ['sư','su','sư thầy','su thay','thầy','thay']], ['nun', ['ni','ni cô','ni co','sư cô','su co']],
  ['child', ['tiểu','tieu','chú tiểu','chu tieu','bé','be']], ['grandpa', ['ông','ong','ông cụ','ong cu','cụ ông','cu ong']],
  ['granny', ['bà','ba','cụ bà','cu ba','cụ','cu']],
  ['woman', ['nữ','nu','chị','chi','gái','gai']], ['man', ['nam','anh','trai']],
];
function skinFromText(t){
  const w = String(t).toLowerCase().normalize('NFC').replace(/[^\p{L}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
  if (!w || w.split(' ').length > 3) return null;
  for (const [skin, words] of SKIN_WORDS) if (words.some(k => w === k || w.startsWith(k + ' '))) return skin;
  return null;
}
const DEFAULT_SKINS = ['woman', 'man', 'woman', 'man', 'granny', 'grandpa'];
// The look comes from a hash of the viewer id, not the arrival order: seats fill left/right in turn, so cycling
// through the list would put every woman on one side of the carpet and every man on the other.
const hashId = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.codePointAt(0), 16777619); return h >>> 0; };
const defaultSkin = id => DEFAULT_SKINS[hashId(id) % DEFAULT_SKINS.length];

function pub(v){ return { id:v.id, name:v.name, skin:v.skin, avatar:v.avatar||'', coins:v.coins, demo:!!v.demo, badge:v.badge||'' }; }
function snapshot(){ return { t:'state', settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, tiktok: tiktokState,
  stats, likeGoal, top: topDonors(), lastOffer, sessionEndsAt, recite, candles: [...candles].map(([id, name]) => ({ id, name })) }; }

function seat(id, name, opts = {}){
  let v = viewers.get(id);
  if (v){ v.lastAt = Date.now(); if (opts.avatar) v.avatar = opts.avatar; return { v, isNew:false }; }
  if (viewers.size >= capacity()){              // full: the longest-quiet non-donor stands up
    const quiet = [...viewers.values()].filter(x => x.coins === 0).sort((a,b) => a.lastAt - b.lastAt)[0];
    if (!quiet) return { v:null, isNew:false };
    viewers.delete(quiet.id); broadcast({ t:'leave', id: quiet.id });
  }
  v = { id, name: (name||id).slice(0, 18), skin: opts.skin || defaultSkin(id),
        avatar: opts.avatar || '', coins: 0, joinedAt: Date.now(), lastAt: Date.now(), demo: !!opts.demo };
  viewers.set(id, v);
  broadcast({ t:'join', v: pub(v), cap: capacity() });
  return { v, isNew:true };
}

/* ------------------------------------------------------------- events in */
function onChat(id, name, text, avatar){
  text = String(text || '').slice(0, 120);
  const want = skinFromText(text);
  const { v, isNew } = seat(id, name, { avatar, skin: want || undefined });
  if (!v) return;
  if (isNew) welcome(v);
  if (!isNew && want && want !== v.skin){ v.skin = want; broadcast({ t:'skin', id, skin: want }); }
  v.lastText = text; v.lastTextAt = Date.now();
  if (asksTeaching(text)) askTeaching(v);
  if (recites(text)) onRecite(v);
  if (lightsCandle(text)) lightCandle(v);
  if (quiz){ const pick = quizAnswer(text); if (pick >= 0) answerQuiz(v, pick); }
  broadcast({ t:'chat', id, name: v.name, text });
}

function onGift(id, name, giftName, count, diamonds, avatar){
  giftName = String(giftName || 'quà').slice(0, 30); count = Math.max(1, Math.min(9999, +count || 1));
  const { v } = seat(id, name, { avatar });
  if (!v) return;
  const coins = Math.max(1, (diamonds || 1) * (count || 1));
  v.coins += coins;
  const kind = offerKind(diamonds || 1); stats[kind] += count; lastOffer = { name: v.name, label: OFFER_LABEL[kind] };
  const d = donors.get(id) || { id, name: v.name, coins: 0 }; d.name = v.name; d.coins += coins; donors.set(id, d);
  const prayer = (v.lastText && Date.now() - v.lastTextAt < 90_000 && v.lastText.length > 6) ? v.lastText : pickPrayer();
  const tier = coins >= 99 ? 3 : coins >= 10 ? 2 : 1;
  broadcast({ t:'gift', id, name: v.name, giftName, count, coins, total: v.coins, tier, prayer, kind, label: OFFER_LABEL[kind], stats, top: topDonors() });
  if (!settings.gifts.readAll && coins < settings.gifts.minDiamonds) return;
  giftTimes.push(Date.now()); while (Date.now() - giftTimes[0] > 20_000) giftTimes.shift();
  const rush = giftTimes.length > 1 || voiceQueued() > 0 || voiceEnd > Date.now();   // another gift lately, or it has to wait
  const w = giftWait.find(g => g.id === id && g.giftName === giftName);   // the same gift again before it was read: one entry
  if (w){ w.count += count; w.coins += coins; w.prayer = prayer; }
  else if (giftWait.length < 60) giftWait.push({ id, name: v.name, giftName, count, coins, prayer, rush });
  else { addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 lượt quà'); return; }
  pumpTTS();
}

function pickPrayer(){
  const P = ['Nguyện cầu gia đạo bình an, vạn sự cát tường', 'Nguyện cầu cha mẹ mạnh khỏe, sống lâu', 'Nguyện hồi hướng công đức cho khắp pháp giới chúng sinh',
             'Nguyện cầu thân tâm an lạc, phiền não tiêu trừ', 'Nguyện cầu công việc hanh thông, gia đình hạnh phúc'];
  return P[Math.floor(Math.random() * P.length)];
}
const spoken = s => String(s).replace(/[_@.]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim() || 'ẩn danh';

/* ------------------------------------------------------------------ TTS */
// The overlay plays lines one after another. A line's words are fixed only when the line playing is about to end (the
// server knows how long each lasts from its audio size, and how long Edge takes to make one), so gifts that come in
// meanwhile wait together and are read in one short line. One full line per gift is ~11 s: in a rush the fourth donor
// heard their name half a minute late. Up to two lines are made at a time and always go out in order.
const ttsQueue = []; let ttsHead = false, ttsSeq = 0;
const making = [];                   // lines whose voice is being made, in the order they go out
const giftWait = [];                 // gifts not read yet: { id, name, giftName, count, coins, prayer, rush }
const giftTimes = [];                // when the gifts of the last 20 s came in
let voiceEnd = 0;                    // when the overlay should be done with every line sent so far
let makeMs = 3000;                   // how long Edge has lately taken to make a line
let pumpTimer = null;
const LINE_GAP = 450;                // the overlay's pause between lines plus fetch and decode
const estSec = text => (1.2 + text.length * .095) * .8 / (1 + settings.rate / 100);   // measured on NamMinh at -20%
const audioSec = (buf, ext) => ext === 'wav' ? (buf.length - 44) / (buf.readUInt32LE(28) || 32000) : buf.length / 12000;   // Edge mp3 is a constant 96 kbit/s
const played = sec => { voiceEnd = Math.max(Date.now(), voiceEnd) + sec * 1000 + LINE_GAP; };
const voiceQueued = () => ttsQueue.length + making.length + (giftWait.length ? 1 : 0);
const ttsCache = new Map();          // voice|pitch|rate|text -> { url, sec }, for the chants that come back every few minutes
function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function say(text, meta = {}){
  if (ttsQueue.length >= 15) { addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 câu'); return; }
  ttsQueue.push({ text: String(text).slice(0, 500), meta });
  pumpTTS();
}
function pumpTTS(){
  clearTimeout(pumpTimer); pumpTimer = null;
  while (making.length < 2 && (giftWait.length || ttsQueue.length)){
    const end = making.reduce((t, it) => t + (it.sec ?? estSec(it.text)) * 1000 + LINE_GAP, Math.max(Date.now(), voiceEnd));
    const wait = end - Date.now() - makeMs - 1200;
    if (wait > 0){ pumpTimer = setTimeout(pumpTTS, Math.min(wait, 5000)); break; }
    const it = giftWait.length ? giftLine() : ttsQueue.shift();   // gifts go ahead of every other line still waiting
    it.job = makeVoice(it.text, it.meta.tag).then(v => (it.sec = v.sec, v));
    it.job.catch(() => {});          // a failure is logged when its turn comes; unhandled it would stop Node
    making.push(it);
  }
  if (ttsHead || !making.length) return; ttsHead = true;
  const it = making[0];
  it.job.then(({ url, sec }) => { broadcast({ t:'tts', url, text: it.text, ...it.meta }); played(sec); }, e => addLog('TTS lỗi: ' + (e?.message || e)))
    .finally(() => { making.shift(); ttsHead = false; pumpTTS(); });
}
// One line for the gifts waiting, up to six donors. A big gift (99 coins or more) is read first, with its prayer. A lone
// gift gets its prayer only when the room is calm; one that came in a rush gets the name and the gift, and the prayer stays
// on screen. Several are named together, grouped by gift, with commas (each full stop is a ~1.2 s pause); the rest wait
// for the next line.
function giftLine(){
  const at = giftWait.findIndex(g => g.coins >= 99), big = at >= 0 ? giftWait.splice(at, 1)[0] : null;
  const rest = giftWait.splice(0, big ? 5 : 6);
  const one = (g, prayer) => `Phật tử ${spoken(g.name)} thành tâm dâng ${g.giftName}${g.count > 1 ? `, ${g.count} lần` : ''}.${prayer ? ` ${g.prayer}.` : ''}`;
  const byGift = new Map(); for (const g of rest) byGift.set(g.giftName, [...(byGift.get(g.giftName) || []), g]);
  const group = ([gift, gs]) => `Phật tử ${joinNames(gs.map(g => spoken(g.name)))} dâng ${gift}${gs.length === 1 && gs[0].count > 1 ? ` ${gs[0].count} lần` : ''}`;
  const others = rest.length === 1 ? one(rest[0], !big && !rest[0].rush) : rest.length ? [...byGift].map(group).join(', ') + '.' : '';
  const n = rest.length + (big ? 1 : 0); if (n > 1) addLog(`Giọng đọc: gộp ${n} lượt quà vào một câu`);
  return { text: `Nam mô A Di Đà Phật. ${big ? one(big, true) + ' ' : ''}${others}`.trim(), meta: { tag:'gift', id: (big || rest[0]).id } };
}
async function makeVoice(text, tag){
  const key = `${settings.voice}|${settings.pitch}|${settings.rate}|${text}`;
  const hit = ttsCache.get(key);
  if (hit && fs.existsSync(path.join(TTS_DIR, path.basename(hit.url)))) return hit;
  let buf, ext = 'mp3'; const t0 = Date.now();
  try { buf = await edgeSpeak(text); }
  catch (e) {
    if (!settings.ttsFallback) throw e;
    buf = await offlineSpeak(text); ext = 'wav';
    addLog(`Giọng đọc: Microsoft lỗi ${TTS_TRIES} lần, đọc bằng giọng dự phòng của Windows`);
  }
  const ms = Date.now() - t0;        // follow a slowdown at once, a recovery slowly
  makeMs = Math.min(15000, Math.max(500, ms > makeMs ? (makeMs + ms) / 2 : makeMs * .8 + ms * .2));
  const file = `${tag === 'chant' ? 'chant' : 'tts'}_${Date.now()}_${++ttsSeq}.${ext}`;
  fs.writeFileSync(path.join(TTS_DIR, file), buf);
  const v = { url: `/live/tts/${file}`, sec: audioSec(buf, ext) };
  if (tag === 'chant' && ext === 'mp3') ttsCache.set(key, v);
  const old = fs.readdirSync(TTS_DIR).filter(f => f.startsWith('tts_')).sort(); while (old.length > 40) { try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {} }
  return v;
}
// Edge TTS often takes the request, then drops the connection (code 1006) ~2.5 s later without any audio: more than half of
// the requests some evenings. So a failed request is sent again at once, and when one is slow a second one starts beside
// it (never more than two at a time); the first to land wins. Eight tries are over within ~13 s even when all fail.
const TTS_TRIES = 8, TTS_HEDGE_MS = 2500;
function edgeOnce(text){
  const tts = new MsEdgeTTS({ synthesisTimeoutMs: 15000 });
  const done = (async () => {
    await tts.setMetadata(settings.voice, OUTPUT_FORMAT.AUDIO_24KHZ_96KBITRATE_MONO_MP3);
    const { audioStream } = tts.toStream(esc(text), { pitch: `${settings.pitch >= 0 ? '+' : ''}${settings.pitch}Hz`, rate: `${settings.rate >= 0 ? '+' : ''}${settings.rate}%` });
    const chunks = [];
    await new Promise((res, rej) => { audioStream.on('data', c => chunks.push(c)); audioStream.on('end', res); audioStream.on('error', rej); audioStream.on('close', () => rej(new Error('closed'))); });
    const buf = Buffer.concat(chunks);
    if (buf.length < 2000) throw new Error('Microsoft trả về câu rỗng');
    return buf;
  })().finally(() => { try { tts.close(); } catch {} });
  return { done, cancel: () => { try { tts.close(); } catch {} } };
}
function edgeSpeak(text){
  return new Promise((resolve, reject) => {
    const live = new Set(), t0 = Date.now(); let started = 0, over = false, timer = null, lastErr;
    const launch = () => {
      if (over || started >= TTS_TRIES || live.size >= 2) return;
      started++; const a = edgeOnce(text); live.add(a);
      clearTimeout(timer); timer = setTimeout(launch, TTS_HEDGE_MS);
      a.done.then(buf => {
        live.delete(a); if (over) return;
        over = true; clearTimeout(timer); for (const x of live) x.cancel();
        if (started > 1) addLog(`Giọng đọc: Microsoft chậm/lỗi, đã gửi ${started} lần, xong sau ${((Date.now() - t0) / 1000).toFixed(1)} giây`);
        resolve(buf);
      }, e => {
        live.delete(a); lastErr = e; if (over) return;
        if (started < TTS_TRIES) launch();
        else if (!live.size){ over = true; clearTimeout(timer); reject(lastErr); }
      });
    };
    launch();
  });
}
// Last resort when Edge keeps failing (off by default): the offline Vietnamese voice that ships with Windows ("Microsoft An"),
// through the WinRT speech API. It sounds far more robotic, but a gift is never left unread. The text goes in through an
// environment variable, never into the script itself.
const OFFLINE_PS = `$ProgressPreference = 'SilentlyContinue'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$v = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.Language -eq 'vi-VN' } | Select-Object -First 1
if (-not $v) { exit 3 }
$s = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$s.Voice = $v
$s.Options.SpeakingRate = [double]$env:TTS_RATE
$s.Options.AudioPitch = [double]$env:TTS_PITCH
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation\`1' } | Select-Object -First 1
$task = $asTask.MakeGenericMethod([Windows.Media.SpeechSynthesis.SpeechSynthesisStream]).Invoke($null, @($s.SynthesizeTextToStreamAsync($env:TTS_TEXT)))
if (-not $task.Wait(20000)) { exit 4 }
$out = [Console]::OpenStandardOutput()
[System.IO.WindowsRuntimeStreamExtensions]::AsStreamForRead($task.Result).CopyTo($out)
$out.Flush()`;
function offlineSpeak(text){
  return new Promise((resolve, reject) => {
    if (process.platform !== 'win32') return reject(new Error('giọng dự phòng chỉ có trên Windows'));
    const p = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(OFFLINE_PS, 'utf16le').toString('base64')], { windowsHide: true,
      env: { ...process.env, TTS_TEXT: text, TTS_RATE: String(1 + settings.rate / 100), TTS_PITCH: String(Math.max(0, 1 + settings.pitch / 100)) } });
    const chunks = [], kill = setTimeout(() => p.kill(), 30000);
    p.stdout.on('data', c => chunks.push(c));
    p.on('error', e => { clearTimeout(kill); reject(e); });
    p.on('close', code => {
      clearTimeout(kill); const buf = Buffer.concat(chunks);
      if (code === 0 && buf.length > 2000) resolve(buf);
      else reject(new Error(code === 3 ? 'Windows chưa cài giọng tiếng Việt' : 'giọng dự phòng lỗi'));
    });
  });
}

const CHANTS = [
  'Nam mô Bổn Sư Thích Ca Mâu Ni Phật. Nguyện đem công đức này, hướng về khắp tất cả, đệ tử và chúng sinh, đều trọn thành Phật đạo.',
  'Nam mô A Di Đà Phật. Nguyện sanh Tây Phương Tịnh Độ trung, cửu phẩm liên hoa vi phụ mẫu.',
  'Nam mô Đại Bi Quán Thế Âm Bồ Tát. Nguyện cho tất cả chúng sinh thân tâm an lạc, tai qua nạn khỏi.',
  'Quán Tự Tại Bồ Tát hành thâm Bát Nhã Ba La Mật Đa thời, chiếu kiến ngũ uẩn giai không, độ nhất thiết khổ ách.',
];
let chantIdx = 0, chantTimer = null;
function chant(){ const text = CHANTS[chantIdx++ % CHANTS.length]; lastChantAt = Date.now(); broadcast({ t:'chant', text }); say(text, { tag:'chant' }); }
function scheduleChant(){ clearInterval(chantTimer); if (settings.autoChant) chantTimer = setInterval(chant, Math.max(1, settings.chantEveryMin) * 60_000); }
scheduleChant();

// A viewer who comments "lời dạy" (or "xin lời Phật dạy") gets one short teaching on the banner with their name, read out
// when the voice is free. Once per viewer every 5 minutes; when many ask, one every 12 s and at most 5 waiting.
const TEACHINGS = [
  'Hận thù không thể dập tắt hận thù. Chỉ có tình thương mới dập tắt được hận thù.',
  'Tâm dẫn đầu mọi việc. Giữ tâm thanh tịnh thì an lạc theo ta như bóng theo hình.',
  'Thắng ngàn quân giặc không bằng tự thắng chính mình.',
  'Một lời nói lành đem lại bình an còn hơn ngàn lời vô ích.',
  'Đừng soi lỗi người. Hãy nhìn lại việc mình đã làm và chưa làm.',
  'Như tảng đá không lay trước gió, người trí không động trước khen chê.',
  'Không làm các điều ác, siêng làm các việc lành, giữ tâm ý trong sạch. Đó là lời chư Phật dạy.',
  'Sống một ngày tỉnh thức còn hơn sống trăm năm buông lung.',
  'Biết đủ là người giàu có nhất.',
  'Giữ cơn giận như cầm hòn than nóng định ném vào người khác: chính mình bị bỏng trước.',
  'Quá khứ đã qua, tương lai chưa tới. Hãy sống trọn vẹn với giây phút hiện tại.',
  'Giọt nước nhỏ mãi cũng đầy bình. Việc lành nhỏ làm mãi cũng thành công đức lớn.',
  'Hãy tự thắp đuốc lên mà đi.',
  'Một ngọn nến thắp sáng ngàn ngọn nến mà không hề tối đi. Hạnh phúc chia sẻ cũng vậy.',
  'Nói lời chân thật, đúng lúc, có ích và từ tâm.',
  'Không ai cứu ta ngoài chính ta. Tự mình phải bước trên con đường ấy.',
  'Không đáp lại cơn giận bằng cơn giận là thắng một trận khó thắng.',
  'Thân người khó được, Phật pháp khó nghe. Hãy trân quý từng ngày đang sống.',
  'Hiếu thảo với cha mẹ là ruộng phước lớn nhất trong đời.',
  'Gieo nhân lành thì gặt quả lành.',
  'Buông xuống được thì nhẹ nhàng, nắm giữ mãi thì khổ đau.',
  'Mọi sự đều vô thường. Hiểu vậy thì được không quá vui, mất không quá buồn.',
  'Thương người như thương thân, lấy lòng từ bi đối đãi muôn loài.',
  'Tâm bình thì thế giới bình.',
];
const plain = s => String(s).normalize('NFD').replace(/\p{M}/gu, '').replace(/đ/gi, 'd').toLowerCase();
const asksTeaching = t => /\bloi (phat )?day\b/.test(plain(t));
const teachQueue = []; let teachIdx = Math.floor(Math.random() * TEACHINGS.length), lastTeachAt = 0;
function askTeaching(v){
  if (!settings.teach || Date.now() - (v.taughtAt || 0) < 300_000 || teachQueue.length >= 5) return;
  v.taughtAt = Date.now(); teachQueue.push({ id: v.id, name: v.name }); giveTeaching();
}
function giveTeaching(){
  if (!teachQueue.length || Date.now() - lastTeachAt < 12_000) return;
  const q = teachQueue.shift(), text = TEACHINGS[teachIdx++ % TEACHINGS.length]; lastTeachAt = Date.now();
  broadcast({ t:'teach', id: q.id, name: q.name, text });
  if (voiceQueued() < 2) say(`Lời Phật dạy cho Phật tử ${spoken(q.name)}. ${text}`, { tag:'teach' });
}
setInterval(giveTeaching, 2000);

// End of a session: the merit is dedicated to the people in the hall by name (most recently active first) while the whole
// hall bows. Staying to the end to hear your name is a reason to stay. Demo people and bots are left out.
function dedicate(){
  const names = [...viewers.values()].filter(v => !v.demo).sort((a, b) => b.lastAt - a.lastAt).map(v => v.name);
  if (!names.length) return false;
  const shown = names.slice(0, 12), more = names.length - shown.length, lit = candles.size;
  broadcast({ t:'dedicate', names: shown, more, candles: lit });
  say(`Hồi hướng công đức khóa lễ cho Phật tử ${shown.map(spoken).join(', ')}${more ? `, cùng ${more} Phật tử khác` : ''} đang có mặt trong chánh điện${lit ? `, cùng ${lit} ngọn nến cầu an` : ''}. Nguyện tất cả thân tâm an lạc, gia đạo bình an. Nam mô A Di Đà Phật.`, { tag:'dedicate' });
  return true;
}

// Names worth saying out loud are gathered and read together in one line, at most every 30 s and only when no other line
// is waiting (a gift is never kept behind them): newcomers (hearing your own name is what makes people stay), new
// followers and sharers (thanking them in public makes others follow and share), and badges for staying.
const announce = { greet: [], follow: [], share: [], badge: [] };
const queueName = (kind, item) => { if (announce[kind].length < 50) announce[kind].push(item); };
function welcome(v){ if (settings.greet && !v.demo) queueName('greet', v.name); }
const joinNames = names => names.length > 1 ? `${names.slice(0, -1).join(', ')} và ${names.at(-1)}` : names[0];
const nameList = names => {
  names = [...new Set(names.map(spoken))]; const shown = names.slice(0, 4), rest = names.length - shown.length;
  return rest > 0 ? `${shown.join(', ')} và ${rest} Phật tử khác` : joinNames(shown);
};
setInterval(() => {
  if (!settings.greet) announce.greet.length = 0;
  if (!settings.thankSocial){ announce.follow.length = 0; announce.share.length = 0; }
  if (!settings.badges) announce.badge.length = 0;
  if (voiceQueued()) return;
  const parts = [];
  if (announce.greet.length) parts.push(`Hoan hỷ chào đón Phật tử ${nameList(announce.greet.splice(0))} vào chánh điện.`);
  if (announce.follow.length) parts.push(`Cảm ơn Phật tử ${nameList(announce.follow.splice(0))} đã theo dõi chánh điện.`);
  if (announce.share.length) parts.push(`Cảm ơn Phật tử ${nameList(announce.share.splice(0))} đã chia sẻ buổi lễ.`);
  const byMins = new Map(); for (const b of announce.badge.splice(0)) byMins.set(b.mins, [...(byMins.get(b.mins) || []), b.name]);
  for (const [mins, names] of byMins) parts.push(`Tùy hỷ Phật tử ${nameList(names)} đã tinh tấn ${mins} phút trong chánh điện.`);
  if (parts.length) say(parts.join(' ') + ' Nam mô A Di Đà Phật.', { tag:'greet' });
}, 30_000);
function thankSocial(kind, id, name){
  broadcast({ t:'social', kind, id, name });
  addLog(kind === 'follow' ? `💛 ${name} theo dõi kênh` : `🔗 ${name} chia sẻ live`);
  if (settings.thankSocial) queueName(kind, name);
}

// Niệm Phật together: every comment with "Nam mô ..." counts toward a shared 108; at 108 the bell rings and a new round
// starts. One count per viewer every 3 s, so a pasted flood doesn't run the count.
const RECITE_ROUND = 108;
const recite = { n: 0, rounds: 0 };
const recites = t => /\bnam mo\b/.test(plain(t));
function onRecite(v){
  if (!settings.recite || Date.now() - (v.recitedAt || 0) < 3000) return;
  v.recitedAt = Date.now();
  if (++recite.n < RECITE_ROUND){ broadcast({ t:'recite', id: v.id, ...recite }); return; }
  recite.n = 0; recite.rounds++;
  broadcast({ t:'recite', id: v.id, ...recite, done: true }); addLog(`📿 Viên mãn ${RECITE_ROUND} biến niệm Phật (vòng ${recite.rounds})`);
  say(`Đại chúng đã cùng niệm đủ ${RECITE_ROUND} biến. Nguyện cho tất cả thân tâm an lạc. Nam mô A Di Đà Phật.`, { tag:'recite' });
}

// Thắp nến cầu an: "thắp nến" lights a candle on the tray before the altar for the rest of the session; the dedication at
// its end counts them, then the tray is cleared for the next one. One candle per viewer, 80 at most.
const candles = new Map();           // id -> name
const lightsCandle = t => /\bthap (nen|den)\b/.test(plain(t));
function lightCandle(v){
  if (!settings.candles || candles.has(v.id) || candles.size >= 80) return;
  candles.set(v.id, v.name); broadcast({ t:'candle', id: v.id, name: v.name, n: candles.size });
}
function clearCandles(){ candles.clear(); broadcast({ t:'candles', list: [] }); }

// Badges for staying: a viewer still active in the hall (a comment or a heart in the last 10 minutes) gets one lotus at 10
// minutes since they sat down, two at 30, three at 60. The name tag shows it and the next announcement names them.
const BADGES = [[10, '🪷'], [30, '🪷🪷'], [60, '🪷🪷🪷']];
setInterval(() => {
  if (!settings.badges) return;
  const now = Date.now();
  for (const v of viewers.values()){
    if (v.demo || now - v.lastAt > 600_000) continue;
    const lvl = BADGES.filter(([m]) => now - v.joinedAt >= m * 60_000).length;
    if (lvl <= (v.badgeLvl || 0)) continue;
    v.badgeLvl = lvl; v.badge = BADGES[lvl - 1][1];
    broadcast({ t:'badge', id: v.id, badge: v.badge }); queueName('badge', { name: v.name, mins: BADGES[lvl - 1][0] });
  }
}, 15_000);

// Đố vui Phật pháp: every quizEveryMin minutes a question with three answers; viewers comment A, B or C (their first answer
// counts). After 30 s: the answer, the first right names, and the Bảng Trí Tuệ (a point per right answer, this run).
// The first option written is the right one; the order is shuffled each time a question is asked.
const QUIZ = [
  ['Đức Phật Thích Ca đản sinh ở đâu?', 'Vườn Lâm Tỳ Ni', 'Bồ Đề Đạo Tràng', 'Câu Thi Na'],
  ['Đức Phật thành đạo dưới cội cây gì?', 'Cây bồ đề', 'Cây đa', 'Cây sala'],
  ['Đức Phật nhập Niết bàn ở đâu?', 'Câu Thi Na', 'Vườn Lộc Uyển', 'Núi Linh Thứu'],
  ['Đức Phật giảng bài pháp đầu tiên ở đâu?', 'Vườn Lộc Uyển', 'Tinh xá Kỳ Viên', 'Tinh xá Trúc Lâm'],
  ['Tên của Đức Phật khi còn là thái tử?', 'Tất Đạt Đa', 'A Nan Đà', 'La Hầu La'],
  ['Phụ vương của Đức Phật là vua nào?', 'Vua Tịnh Phạn', 'Vua A Dục', 'Vua Tần Bà Sa La'],
  ['Mẫu hậu của Đức Phật là ai?', 'Hoàng hậu Ma Da', 'Công chúa Da Du Đà La', 'Bà Ma Ha Ba Xà Ba Đề'],
  ['Tam Bảo gồm những gì?', 'Phật, Pháp, Tăng', 'Giới, Định, Tuệ', 'Thân, Khẩu, Ý'],
  ['Tam độc là gì?', 'Tham, sân, si', 'Sinh, lão, tử', 'Thân, khẩu, ý'],
  ['Tứ Diệu Đế có mấy chân lý?', 'Bốn', 'Ba', 'Tám'],
  ['Bát Chánh Đạo có mấy chi?', 'Tám', 'Sáu', 'Mười'],
  ['Phật tử tại gia thường thọ trì mấy giới?', 'Năm giới', 'Tám giới', 'Mười giới'],
  ['Vị Bồ Tát lắng nghe tiếng kêu cứu khổ của chúng sinh?', 'Quán Thế Âm', 'Văn Thù', 'Phổ Hiền'],
  ['Bồ Tát Văn Thù tiêu biểu cho điều gì?', 'Trí tuệ', 'Từ bi', 'Hạnh nguyện'],
  ['Lễ Phật Đản ở Việt Nam vào ngày nào âm lịch?', 'Rằm tháng Tư', 'Rằm tháng Giêng', 'Rằm tháng Bảy'],
  ['Lễ Vu Lan báo hiếu vào ngày nào âm lịch?', 'Rằm tháng Bảy', 'Rằm tháng Tám', 'Rằm tháng Mười'],
  ['Đức Phật A Di Đà là giáo chủ cõi nào?', 'Tây Phương Cực Lạc', 'Đông Phương Tịnh Lưu Ly', 'Cõi Ta Bà'],
  ['Đức Phật Dược Sư là giáo chủ cõi nào?', 'Đông Phương Tịnh Lưu Ly', 'Tây Phương Cực Lạc', 'Cung trời Đâu Suất'],
  ['Vị đệ tử được gọi là Đa văn đệ nhất?', 'Ngài A Nan', 'Ngài Ca Diếp', 'Ngài Mục Kiền Liên'],
  ['Vị đệ tử được gọi là Thần thông đệ nhất?', 'Ngài Mục Kiền Liên', 'Ngài Xá Lợi Phất', 'Ngài Tu Bồ Đề'],
  ['Vị đệ tử được gọi là Trí tuệ đệ nhất?', 'Ngài Xá Lợi Phất', 'Ngài A Nan', 'Ngài La Hầu La'],
  ['Tích Mục Kiền Liên cứu mẹ gắn với lễ nào?', 'Lễ Vu Lan', 'Lễ Phật Đản', 'Lễ Thành Đạo'],
  ['Bồ Tát nào phát nguyện "Địa ngục chưa trống, thề không thành Phật"?', 'Địa Tạng', 'Quán Thế Âm', 'Di Lặc'],
  ['Vị Phật tương lai sẽ ra đời là ai?', 'Phật Di Lặc', 'Phật A Di Đà', 'Phật Dược Sư'],
  ['Vị vua Ấn Độ hộ trì Phật pháp, dựng nhiều trụ đá khắc chỉ dụ?', 'Vua A Dục', 'Vua Tịnh Phạn', 'Vua Ba Tư Nặc'],
  ['Ai sáng lập Thiền phái Trúc Lâm Yên Tử?', 'Vua Trần Nhân Tông', 'Vua Lý Công Uẩn', 'Vua Lê Thánh Tông'],
  ['Trong Lục độ, hạnh nào đứng đầu?', 'Bố thí', 'Trì giới', 'Nhẫn nhục'],
  ['Kinh nào mở đầu bằng "Quán Tự Tại Bồ Tát..."?', 'Bát Nhã Tâm Kinh', 'Kinh Pháp Hoa', 'Kinh Địa Tạng'],
  ['"Nam mô" nghĩa là gì?', 'Quy y, kính lạy', 'Cầu xin', 'Tạm biệt'],
  ['Loài hoa tượng trưng cho sự thanh tịnh trong Phật giáo?', 'Hoa sen', 'Hoa hồng', 'Hoa cúc'],
  ['Chùa Một Cột ở thành phố nào?', 'Hà Nội', 'Huế', 'Đà Nẵng'],
  ['Chùa Thiên Mụ ở thành phố nào?', 'Huế', 'Hà Nội', 'Hội An'],
];
const QUIZ_SEC = 30;
const quizOrder = QUIZ.map((_, i) => i).sort(() => Math.random() - .5);
const quizScores = new Map();        // id -> { id, name, score }
let quiz = null, quizIdx = 0, lastQuizAt = Date.now(), lastChantAt = 0, quizCountTimer = null;
const quizAnswer = t => { const m = plain(t).match(/^\s*(?:dap an\s*)?([abc])\s*[.!]*\s*$/); return m ? 'abc'.indexOf(m[1]) : -1; };
// The question goes up together with its voice: Edge can take 20 s to answer, and a voice that comes in when the time is
// nearly over is no use. If the voice isn't there within 12 s the question goes up without it.
function startQuiz(){
  if (quiz) return false;
  const [q, ...opts] = QUIZ[quizOrder[quizIdx++ % QUIZ.length]], order = [0, 1, 2].sort(() => Math.random() - .5);
  const qz = quiz = { q, options: order.map(i => opts[i]), right: order.indexOf(0), ready: false, answers: new Map() };
  const text = `Câu đố Phật pháp. ${q} A, ${qz.options[0]}. B, ${qz.options[1]}. C, ${qz.options[2]}. Mời đại chúng bình luận A, B hoặc C.`;
  const go = voice => {
    if (qz.ready || quiz !== qz) return; qz.ready = true; lastQuizAt = Date.now();
    broadcast({ t:'quiz', q, options: qz.options, endsAt: Date.now() + QUIZ_SEC * 1000 });
    if (voice){ broadcast({ t:'tts', url: voice.url, text, tag:'quiz' }); played(voice.sec); }
    setTimeout(endQuiz, QUIZ_SEC * 1000);
  };
  addLog(`❓ Câu đố: ${q}`);
  makeVoice(text, 'quiz').then(go, () => go()); setTimeout(() => go(), 12_000);
  return true;
}
function answerQuiz(v, pick){
  if (!quiz?.ready || quiz.answers.has(v.id)) return;
  quiz.answers.set(v.id, { id: v.id, name: v.name, pick });
  quizCountTimer ||= setTimeout(() => { quizCountTimer = null; if (quiz) broadcast({ t:'quizCount', n: quiz.answers.size }); }, 1000);
}
function endQuiz(){
  if (!quiz) return; const qz = quiz; quiz = null; lastQuizAt = Date.now();
  const right = [...qz.answers.values()].filter(a => a.pick === qz.right);           // in the order they answered
  for (const a of right){ const s = quizScores.get(a.id) || { id: a.id, name: a.name, score: 0 }; s.name = a.name; s.score++; quizScores.set(a.id, s); }
  const top = [...quizScores.values()].sort((a, b) => b.score - a.score).slice(0, 3);
  broadcast({ t:'quizEnd', right: qz.right, winners: right.slice(0, 5).map(a => a.name), nRight: right.length, nAll: qz.answers.size, top });
  say(`Đáp án đúng là ${'ABC'[qz.right]}, ${qz.options[qz.right]}.${right.length ? ` Chúc mừng Phật tử ${nameList(right.map(a => a.name))} đã trả lời đúng.` : ''}`, { tag:'quiz' });
}
setInterval(() => {
  if (settings.quizEveryMin && !quiz && Date.now() - lastQuizAt >= settings.quizEveryMin * 60_000 && Date.now() - lastChantAt > 40_000) startQuiz();
}, 5000);

/* --------------------------------------------------------------- TikTok */
let TikTokLib = null;
async function connectTikTok(uniqueId){
  uniqueId = String(uniqueId || '').trim().replace(/^.*tiktok\.com\/@?/i, '').replace(/^@/, '').replace(/\/.*$/, '');
  if (!uniqueId) return;
  await disconnectTikTok();
  tiktokState = { status: 'connecting', uniqueId, error: '' }; broadcast({ t:'tiktok', ...tiktokState });
  try {
    TikTokLib ||= await import('tiktok-live-connector');
    const { TikTokLiveConnection, WebcastEvent, ControlEvent } = TikTokLib;
    const conn = new TikTokLiveConnection(uniqueId, { enableExtendedGiftInfo: false, processInitialData: false });
    // v2 events use the tiktok-live-proto v3 shape (user.displayId / user.id, chat.content, gift.gift, like.count); older names kept as fallback
    const av = u => u?.avatarThumb?.urlList?.[0] || u?.profilePicture?.url?.[0] || u?.profilePicture?.urlList?.[0] || u?.avatarThumb?.url?.[0] || '';
    const uid = u => u?.displayId || u?.uniqueId || (u?.id && String(u.id)) || u?.userId;
    const nm = u => u?.nickname || uid(u) || 'ẩn danh';
    conn.on(WebcastEvent.CHAT, d => { const id = uid(d.user); if (id) onChat(id, nm(d.user), d.content ?? d.comment, av(d.user)); });
    conn.on(WebcastEvent.GIFT, d => {
      const g = d.gift || d.giftDetails || {};
      const type = g.type ?? g.giftType ?? d.extendedGiftInfo?.type;
      if (type === 1 && !d.repeatEnd) return;                       // streak still running
      const gname = g.name || g.giftName || d.extendedGiftInfo?.name || 'quà';
      const dia = g.diamondCount ?? d.extendedGiftInfo?.diamond_count ?? 1;
      const id = uid(d.user); if (!id) return;
      onGift(id, nm(d.user), gname, d.repeatCount || 1, dia, av(d.user));
      addLog(`🎁 ${nm(d.user)} tặng ${gname} x${d.repeatCount || 1}`);
    });
    conn.on(WebcastEvent.MEMBER, d => { const id = uid(d.user); if (settings.joinOnEnter && id){ const { v, isNew } = seat(id, nm(d.user), { avatar: av(d.user) }); if (v && isNew) welcome(v); } });
    conn.on(WebcastEvent.LIKE, d => { const n = d.count || d.likeCount || 1, id = uid(d.user), v = viewers.get(id); if (v) v.lastAt = Date.now(); addLikes(n); broadcast({ t:'like', id, n }); });
    conn.on(WebcastEvent.FOLLOW, d => { const id = uid(d.user); if (id) thankSocial('follow', id, nm(d.user)); });
    conn.on(WebcastEvent.SHARE, d => { const id = uid(d.user); if (id) thankSocial('share', id, nm(d.user)); });
    conn.on(ControlEvent.DISCONNECTED, () => { tiktokState = { ...tiktokState, status: 'disconnected' }; broadcast({ t:'tiktok', ...tiktokState }); addLog('TikTok: mất kết nối'); });
    conn.on(ControlEvent.ERROR, e => addLog('TikTok lỗi: ' + (e?.info || e?.message || e)));
    const st = await conn.connect();
    tiktok = conn;
    tiktokState = { status: 'connected', uniqueId, error: '', roomId: st?.roomId || '' };
    addLog(`✅ Đã kết nối live @${uniqueId}`);
  } catch (e) {
    tiktokState = { status: 'error', uniqueId, error: String(e?.message || e) };
    addLog(`❌ Không kết nối được @${uniqueId}: ${tiktokState.error}`);
  }
  broadcast({ t:'tiktok', ...tiktokState });
}
async function disconnectTikTok(){ if (tiktok){ try { await tiktok.disconnect(); } catch {} tiktok = null; } tiktokState = { status:'idle', uniqueId:'', error:'' }; broadcast({ t:'tiktok', ...tiktokState }); }

/* ------------------------------------------------------------- test data */
const DEMO_NAMES = ['Diệu Hạnh','Minh Tâm','Thiện Đức','Huệ An','Tịnh Nhã','Quảng Trí','Chơn Như','Pháp Hỷ','Nguyên Thanh','Tâm Đăng','Diệu Liên','Trí Hải','Phước Lộc','Hạnh Nguyện','Như Ý','Bảo Châu','Thanh Lương','Từ Tâm','An Lạc','Giác Hoa','Tuệ Minh','Liên Hương','Thu Hà','Ngọc Lan','Đức Anh','Hải Đăng','Mai Anh','Phương Thảo','Trung Kiên','Quang Huy','Bảo Ngọc','Diệu Linh'];
// Sets the number of demo people to exactly n: adds the missing ones, or sends the extra ones away (newest first).
// Bots and real viewers are left alone.
function fillDemo(n){
  const demos = [...viewers.keys()].filter(id => id.startsWith('demo_')).sort((a, b) => +b.slice(5) - +a.slice(5));
  for (const id of demos.slice(0, Math.max(0, demos.length - n))){ viewers.delete(id); broadcast({ t:'leave', id }); }
  let have = Math.min(n, demos.length);
  for (let i = 0; have < n && viewers.size < capacity(); i++){
    if (viewers.has('demo_' + i)) continue;
    const name = DEMO_NAMES[i % DEMO_NAMES.length] + (i >= DEMO_NAMES.length ? ' ' + (Math.floor(i / DEMO_NAMES.length) + 1) : '');
    seat('demo_' + i, name, { demo: true, skin: defaultSkin('demo_' + i) }); have++;
  }
  return have;
}
function clearSeats(){ viewers.clear(); broadcast(snapshot()); addLog('Đã làm trống bồ đoàn'); }
function resetStats(){ for (const k in stats) stats[k] = 0; likeGoal = nextGoal(); donors.clear(); lastOffer = null; for (const v of viewers.values()) v.coins = 0; broadcast(snapshot()); addLog('Đã xóa bảng lễ vật và Tấm Lòng Thành'); }

/* ------------------------------------------------------------- control */
function onControl(m){
  switch (m.cmd){
    case 'connect': connectTikTok(m.uniqueId); break;
    case 'disconnect': disconnectTikTok(); addLog('Đã ngắt kết nối TikTok'); break;
    case 'chat': { const n = String(m.name || 'Khách').slice(0, 18); onChat('sim_' + n, n, String(m.text || 'Nam mô A Di Đà Phật').slice(0, 120)); break; }
    case 'gift': { const n = String(m.name || 'Khách').slice(0, 18); onGift('sim_' + n, n, String(m.gift || 'Hoa hồng').slice(0, 30), clamp(m.count, 1, 99), clamp(m.diamonds, 1, 50000)); break; }
    case 'fill': { const d = fillDemo(clamp(m.n, 0, MAX_SEATS)); addLog(`Người mẫu: ${d} · tổng trong chánh điện: ${viewers.size} người`); break; }
    case 'clear': clearSeats(); break;
    case 'resetStats': resetStats(); break;
    case 'session': resetSession(); addLog(`⏱ Bắt đầu lại khóa lễ ${settings.sessionMin} phút`); break;
    case 'bell': broadcast({ t:'bell' }); break;
    case 'mo': broadcast({ t:'mo1' }); break;
    case 'chant': chant(); break;
    case 'procession': broadcast({ t:'procession' }); break;
    case 'giftHint': broadcast({ t:'gifthint' }); break;
    case 'quiz': if (!startQuiz()) addLog('Đang có câu đố, đợi câu này xong'); break;
    case 'social': { const n = String(m.name || 'Khách').slice(0, 18); thankSocial(m.kind === 'share' ? 'share' : 'follow', 'sim_' + n, n); break; }
    case 'lotus': broadcast({ t:'likegoal', goal: likeGoal || settings.likeStep || 1000, next: likeGoal }); break;   // try the lotus rain, the count stays
    case 'dedicate': if (!dedicate()) addLog('Chưa có người xem thật trong chánh điện để hồi hướng'); break;
    case 'say': if (m.text) say(String(m.text).slice(0, 400), { tag:'say' }); break;
    case 'settings': {
      const before = settings.sessionMin, step = settings.likeStep;
      applySettings(m.settings || {});
      scheduleChant(); broadcast({ t:'settings', settings, cap: capacity() });
      if (settings.sessionMin !== before) resetSession();
      if (settings.likeStep !== step){ likeGoal = nextGoal(); pushStats(); }
      break; }
    case 'bots': setBots(!!m.on, +m.n || 12, m.pace); break;
  }
}

// Only known keys, right types, sane ranges: the panel is local, but nothing from the socket is trusted blindly.
const SETTING_RULES = {
  title: v => String(v).slice(0, 40), subtitle: v => String(v).slice(0, 60),
  voice: v => ['vi-VN-NamMinhNeural', 'vi-VN-HoaiMyNeural'].includes(v) ? v : settings.voice,
  pitch: v => clamp(v, -50, 50), rate: v => clamp(v, -50, 50), moBpm: v => clamp(v, 20, 120), chantEveryMin: v => clamp(v, 1, 60),
  sessionMin: v => clamp(v, 5, 240), frameSize: v => clamp(v, 70, 100), bustle: v => clamp(v, 0, 3), peopleSize: v => clamp(v, 100, 150),
  likeStep: v => [0, 300, 500, 1000, 2000, 5000].includes(+v) ? +v : settings.likeStep,
  music: Boolean, mo: Boolean, autoChant: Boolean, joinOnEnter: Boolean, ttsFallback: Boolean, greet: Boolean,
  procession: Boolean, teach: Boolean, dedicate: Boolean, giftHint: Boolean,
  recite: Boolean, thankSocial: Boolean, candles: Boolean, badges: Boolean,
  quizEveryMin: v => [0, 3, 5, 10, 15].includes(+v) ? +v : settings.quizEveryMin,
  seatMode: v => ['auto', '50', '100', '150', '200'].includes(String(v)) ? String(v) : 'auto',
};
const clamp = (v, a, b) => Math.max(a, Math.min(b, Math.round(+v || 0)));
function applySettings(o){ for (const [k, fn] of Object.entries(SETTING_RULES)) if (k in o) settings[k] = fn(o[k]); }

/* ----------------------------------------------------------------- bots */
let botTimer = null;
const BOT_LINES = ['Nam mô A Di Đà Phật', 'Nam mô Bổn Sư Thích Ca Mâu Ni Phật', 'Cầu cho gia đình bình an', 'Con xin thành tâm sám hối', 'nữ', 'nam', 'bà',
  'Nguyện cầu cha mẹ mạnh khỏe', 'Mô Phật, an lạc quá', 'Chúc mọi người một ngày bình an', 'sư', 'Cầu công việc hanh thông'];
function setBots(on, n, pace){
  clearInterval(botTimer); botTimer = null;
  if (on){
    n = clamp(n, 1, MAX_SEATS);
    for (let i = 0; i < n; i++) seat('bot_' + i, DEMO_NAMES[(i + 7) % DEMO_NAMES.length] + ' ·bot', { demo: true });
    const every = { slow: 4000, mid: 1800, fast: 700 }[pace] || 1800;
    botTimer = setInterval(() => {
      const ids = [...viewers.keys()].filter(id => id.startsWith('bot_')); if (!ids.length) return;
      const id = ids[Math.floor(Math.random() * ids.length)], v = viewers.get(id), r = Math.random();
      if (r < .62) onChat(id, v.name, BOT_LINES[Math.floor(Math.random() * BOT_LINES.length)]);
      else if (r < .9) { const n = 1 + Math.floor(Math.random() * 4); addLikes(n); broadcast({ t:'like', id, n }); }
      else if (r < .96) onGift(id, v.name, 'Hoa hồng', 1 + Math.floor(Math.random() * 3), 1);
      else if (r < .985) onGift(id, v.name, 'Cỏ bốn lá', 1, 10);
      else onGift(id, v.name, 'Thả tim', 1, 100);
    }, every);
    addLog(`🤖 Bật ${n} bot, nhịp ${pace}`);
  } else {
    for (const id of [...viewers.keys()]) if (id.startsWith('bot_')) { viewers.delete(id); broadcast({ t:'leave', id }); }
    addLog('🤖 Tắt bot');
  }
  broadcast({ t:'bots', on }, 'control');
}

/* -------------------------------------------------------------- server */
// Security notes (this file is meant to be shared publicly):
//  • listens on 127.0.0.1 only; nothing is reachable from the LAN or internet unless HOST is changed on purpose
//  • Host header must be localhost/127.0.0.1 (blocks DNS-rebinding pages from talking to the server)
//  • WebSocket only accepts pages served by this server (Origin check), so other sites open in the
//    same browser cannot send control commands
//  • static files: only /assets and /live, no dot-files, no node_modules, no server source, no path escapes
//  • no TikTok password, cookie or session is ever used or stored; only public room events are read
const HOST = process.env.HOST || '127.0.0.1';
const MIME = { '.html':'text/html; charset=utf-8', '.js':'text/javascript', '.css':'text/css', '.json':'application/json',
  '.png':'image/png', '.jpg':'image/jpeg', '.webp':'image/webp', '.mp3':'audio/mpeg', '.wav':'audio/wav', '.svg':'image/svg+xml', '.ico':'image/x-icon' };
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const okHost = h => ALLOWED_HOSTS.has(String(h || '').toLowerCase());
const SEP = path.sep;
function resolveStatic(urlPath){
  let p = urlPath === '/' ? '/live/control.html' : urlPath;
  if (!/^\/(assets|live)\//.test(p)) return null;
  if (p.split('/').some(seg => seg.startsWith('.') || seg === 'node_modules')) return null;
  if (/\.(mjs|json|md|log)$/i.test(p) && !p.startsWith('/assets/')) return null;      // never serve server code / package files
  const file = path.normalize(path.join(ROOT, p));
  if (!file.startsWith(ROOT + SEP)) return null;
  return file;
}
const server = http.createServer((req, res) => {
  if (!okHost(req.headers.host)) { res.writeHead(421).end('wrong host'); return; }
  if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405).end(); return; }
  let p; try { p = decodeURIComponent(new URL(req.url, 'http://x').pathname); } catch { res.writeHead(400).end(); return; }
  const file = resolveStatic(p);
  if (!file) { res.writeHead(404).end('not found'); return; }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': p.startsWith('/live/tts/') ? 'no-store' : 'no-cache', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' });
    if (req.method === 'HEAD') { res.end(); return; }
    fs.createReadStream(file).pipe(res);
  });
});
const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 64 * 1024,
  verifyClient: ({ origin, req }) => {
    if (!okHost(req.headers.host)) return false;
    if (!origin) return true;                                   // OBS / non-browser clients send no Origin
    try { return okHost(new URL(origin).host); } catch { return false; }
  } });
function broadcast(msg, only){ const s = JSON.stringify(msg); for (const c of wss.clients) if (c.readyState === 1 && (!only || c.role === only)) c.send(s); }
/* Only one overlay plays sound: the same voice from two overlays (LIVE Studio "Link" + a Chrome window) a moment apart
   is heard as an echo. A browser source in the streaming app (its sound starts without a click) wins over a Chrome
   window, the newest wins among equals; when it closes the next one takes over. The panel also sees the pixel size that
   overlay renders at: a Link source left at another size gets scaled up by the streaming app and looks blurry. */
let overlaySeq = 0, voiceInfo = { n: 0, voice: '', size: null };
function pickVoice(){
  const ovs = [...wss.clients].filter(c => c.readyState === 1 && c.role === 'overlay');
  const voice = ovs.reduce((b, c) => !b || c.autoSound > b.autoSound || (c.autoSound === b.autoSound && c.seq > b.seq) ? c : b, null);
  for (const c of ovs) c.send(JSON.stringify({ t:'voice', on: c === voice }));
  voiceInfo = { n: ovs.length, voice: !voice ? '' : voice.autoSound ? 'link' : 'window', size: voice?.size || null };
  broadcast({ t:'overlays', ...voiceInfo }, 'control');
}
wss.on('connection', (ws, req) => {
  const q = new URL(req.url, 'http://x').searchParams;
  ws.role = q.get('role') === 'control' ? 'control' : 'overlay';
  ws.send(JSON.stringify(snapshot()));
  if (ws.role === 'control') ws.send(JSON.stringify({ t:'logs', lines: log }));
  if (ws.role === 'control') ws.send(JSON.stringify({ t:'overlays', ...voiceInfo }));
  else { ws.seq = ++overlaySeq; ws.autoSound = q.get('sound') === 'auto' ? 1 : 0; pickVoice(); ws.on('close', pickVoice); }
  ws.on('message', buf => {
    if (ws.role !== 'control'){                                 // overlays only report their size, nothing else
      try { const m = JSON.parse(buf); if (m?.t === 'size' && m.w > 0 && m.h > 0){ const d = clamp((+m.d || 1) * 100, 50, 400) / 100; ws.size = [clamp(m.w * d, 1, 9999), clamp(m.h * d, 1, 9999)]; pickVoice(); } } catch {}
      return;
    }
    try { const m = JSON.parse(buf); if (m && m.t === 'ctl') onControl(m); } catch (e) { addLog('Lệnh lỗi: ' + e.message); }
  });
});
server.listen(PORT, HOST, () => addLog(`Server chạy tại http://localhost:${PORT}  ·  Bảng điều khiển: http://localhost:${PORT}/live/control.html  ·  Overlay: http://localhost:${PORT}/live/overlay.html`));
