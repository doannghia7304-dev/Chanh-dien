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
setInterval(() => { if (Date.now() >= sessionEndsAt){ resetSession(); broadcast({ t:'bell' }); chant(); if (settings.dedicate) dedicate(); addLog('🔔 Hết khóa lễ, bắt đầu khóa mới'); } }, 1000);

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

function pub(v){ return { id:v.id, name:v.name, skin:v.skin, avatar:v.avatar||'', coins:v.coins, demo:!!v.demo }; }
function snapshot(){ return { t:'state', settings, viewers:[...viewers.values()].map(pub), cap: capacity(), startedAt, tiktok: tiktokState,
  stats, likeGoal, top: topDonors(), lastOffer, sessionEndsAt }; }

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
  const line = `Nam mô A Di Đà Phật. Phật tử ${spoken(v.name)} thành tâm dâng ${giftName}${count > 1 ? ', ' + count + ' lần' : ''}. ${prayer}.`;
  broadcast({ t:'gift', id, name: v.name, giftName, count, coins, total: v.coins, tier, prayer, kind, label: OFFER_LABEL[kind], stats, top: topDonors() });
  if (settings.gifts.readAll || coins >= settings.gifts.minDiamonds) say(line, { tag:'gift', id });
}

function pickPrayer(){
  const P = ['Nguyện cầu gia đạo bình an, vạn sự cát tường', 'Nguyện cầu cha mẹ mạnh khỏe, sống lâu', 'Nguyện hồi hướng công đức cho khắp pháp giới chúng sinh',
             'Nguyện cầu thân tâm an lạc, phiền não tiêu trừ', 'Nguyện cầu công việc hanh thông, gia đình hạnh phúc'];
  return P[Math.floor(Math.random() * P.length)];
}
const spoken = s => String(s).replace(/[_@.]+/g, ' ').replace(/[^\p{L}\p{N}\s]/gu, '').replace(/\s+/g, ' ').trim() || 'ẩn danh';

/* ------------------------------------------------------------------ TTS */
// Lines are made up to two at a time (the next one is ready when the current one ends) but always go out in order.
const ttsQueue = []; let ttsHead = false, ttsSeq = 0;
const ttsCache = new Map();          // voice|pitch|rate|text -> url, for the chants that come back every few minutes
function esc(s){ return String(s).replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c])); }
function say(text, meta = {}){
  if (ttsQueue.length >= 15) { addLog('Hàng đợi giọng đọc đầy, bỏ qua 1 câu'); return; }
  const it = { text: String(text).slice(0, 500), meta };
  const at = meta.tag === 'gift' ? ttsQueue.findIndex(x => !x.job && x.meta.tag !== 'gift') : -1;   // a gift goes ahead of greetings and chants not yet being made
  if (at >= 0) ttsQueue.splice(at, 0, it); else ttsQueue.push(it);
  pumpTTS();
}
function pumpTTS(){
  for (const it of ttsQueue.slice(0, 2)) if (!it.job){ it.job = makeVoice(it.text, it.meta.tag); it.job.catch(() => {}); }   // a failure is logged when its turn comes; unhandled it would stop Node
  if (ttsHead || !ttsQueue.length) return; ttsHead = true;
  const it = ttsQueue[0];
  it.job.then(url => broadcast({ t:'tts', url, text: it.text, ...it.meta }), e => addLog('TTS lỗi: ' + (e?.message || e)))
    .finally(() => { ttsQueue.shift(); ttsHead = false; pumpTTS(); });
}
async function makeVoice(text, tag){
  const key = `${settings.voice}|${settings.pitch}|${settings.rate}|${text}`;
  const hit = ttsCache.get(key);
  if (hit && fs.existsSync(path.join(TTS_DIR, path.basename(hit)))) return hit;
  let buf, ext = 'mp3';
  try { buf = await edgeSpeak(text); }
  catch (e) {
    if (!settings.ttsFallback) throw e;
    buf = await offlineSpeak(text); ext = 'wav';
    addLog(`Giọng đọc: Microsoft lỗi ${TTS_TRIES} lần, đọc bằng giọng dự phòng của Windows`);
  }
  const file = `${tag === 'chant' ? 'chant' : 'tts'}_${Date.now()}_${++ttsSeq}.${ext}`;
  fs.writeFileSync(path.join(TTS_DIR, file), buf);
  const url = `/live/tts/${file}`;
  if (tag === 'chant' && ext === 'mp3') ttsCache.set(key, url);
  const old = fs.readdirSync(TTS_DIR).filter(f => f.startsWith('tts_')).sort(); while (old.length > 40) { try { fs.unlinkSync(path.join(TTS_DIR, old.shift())); } catch {} }
  return url;
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
function chant(){ const text = CHANTS[chantIdx++ % CHANTS.length]; broadcast({ t:'chant', text }); say(text, { tag:'chant' }); }
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
  if (ttsQueue.length < 2) say(`Lời Phật dạy cho Phật tử ${spoken(q.name)}. ${text}`, { tag:'teach' });
}
setInterval(giveTeaching, 2000);

// End of a session: the merit is dedicated to the people in the hall by name (most recently active first) while the whole
// hall bows. Staying to the end to hear your name is a reason to stay. Demo people and bots are left out.
function dedicate(){
  const names = [...viewers.values()].filter(v => !v.demo).sort((a, b) => b.lastAt - a.lastAt).map(v => v.name);
  if (!names.length) return false;
  const shown = names.slice(0, 12), more = names.length - shown.length;
  broadcast({ t:'dedicate', names: shown, more });
  say(`Hồi hướng công đức khóa lễ cho Phật tử ${shown.map(spoken).join(', ')}${more ? `, cùng ${more} Phật tử khác` : ''} đang có mặt trong chánh điện. Nguyện tất cả thân tâm an lạc, gia đạo bình an. Nam mô A Di Đà Phật.`, { tag:'dedicate' });
  return true;
}

// Viewers who come in are welcomed by name: hearing their own name is what makes people stay. Names are gathered and read
// together in one line, at most every 30 s, and only when no other line is waiting, so a gift is never kept behind them.
const greetQueue = [];
function welcome(v){ if (settings.greet && !v.demo && greetQueue.length < 50) greetQueue.push(v.name); }
setInterval(() => {
  if (!settings.greet){ greetQueue.length = 0; return; }
  if (!greetQueue.length || ttsQueue.length) return;
  const names = [...new Set(greetQueue.splice(0).map(spoken))], shown = names.slice(0, 4), rest = names.length - shown.length;
  const list = rest > 0 ? `${shown.join(', ')} và ${rest} Phật tử khác` : shown.length > 1 ? `${shown.slice(0, -1).join(', ')} và ${shown.at(-1)}` : shown[0];
  say(`Hoan hỷ chào đón Phật tử ${list} vào chánh điện. Nam mô A Di Đà Phật.`, { tag:'greet' });
}, 30_000);

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
    conn.on(WebcastEvent.LIKE, d => { const n = d.count || d.likeCount || 1; addLikes(n); broadcast({ t:'like', id: uid(d.user), n }); });
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
