# Chánh Điện Tịnh Tâm

Chánh điện online 2.5D cho TikTok LIVE. Mỗi người xem bình luận là bước vào chánh điện, ngồi xuống bồ đoàn tụng kinh. Ai tặng quà sẽ được xướng tên hồi hướng bằng giọng đọc tiếng Việt. Có nhạc thiền, chuông, mõ và đọc kinh định kỳ.

Mã nguồn chia sẻ miễn phí (MIT). Có hai phần:

| Thư mục | Là gì |
|---|---|
| `index.html`, `assets/` | Bản web tĩnh cho mọi người tự vào ngồi tụng (đăng lên Cloudflare Pages) |
| `live/` | Bộ công cụ phát LIVE: server Node, overlay 9:16, bảng điều khiển |

## Chạy bộ LIVE trên máy phát

Cần Node.js 20 trở lên.

```bash
cd live
npm install
npm start
```

1. Mở `http://localhost:3000/live/control.html` (bảng điều khiển).
2. Trong TikTok LIVE Studio: *Add source → Link*, dán `http://localhost:3000/live/overlay.html`, bật độ phân giải tùy chỉnh và đặt 1080×1920 (mặc định là 800×600: phải phóng to gần 4 lần, hình sẽ rất mờ). Chip **Overlay** trên bảng điều khiển hiện kích thước thật của nguồn Link và cảnh báo nếu chưa đúng. Với OBS thì dùng *Browser source* cùng địa chỉ và kích thước. Cách này nét nhất và tự phát tiếng. Không nên dùng *Window capture*: cửa sổ trình duyệt thấp hơn 1920 px nên hình bị phóng to, mờ, và dính thanh địa chỉ.
3. Chỉ một overlay phát tiếng: nguồn Link được ưu tiên, các cửa sổ overlay khác (ví dụ **Mở màn hình overlay 9:16** để xem thử) tự im lặng nên không bị vọng tiếng. Chip **Overlay** trên bảng điều khiển cho biết tiếng đang phát ở đâu. Điện thoại cắt bớt hai mép khi xem LIVE; nếu mép cảnh bị mất, giảm **Kích thước khung hình** (mặc định 90%) trong bảng điều khiển.
4. Bật LIVE trên TikTok, nhập `@username` vào bảng điều khiển, bấm **Kết nối**.

Chưa live vẫn thử được: dùng **Thử tương tác**, **Đổ người mẫu 30/80/150/200** hoặc **Bot mô phỏng**.

### Người xem làm được gì

- **Bình luận bất kỳ**: đi dọc thảm đỏ vào quỳ (tối đa 200 chỗ), bình luận hiện thành bong bóng chữ trên đầu, và được xướng tên chào đón (nhiều người mới gộp vào một câu, tối đa 30 giây một câu, quà luôn được đọc trước; tắt được trong bảng điều khiển). Đầy chỗ thì người im lặng lâu nhất mà chưa tặng quà sẽ nhường chỗ. Góc trên bên trái overlay luôn có dòng mời **Bình luận để vào chánh điện** cho người vừa lướt vào.
- **Bình luận đúng một từ** `nam`, `nữ`, `ông`, `bà`, `sư`, `ni`, `tiểu`, `cao tăng`: đổi hình nhân vật. Câu "Nam mô A Di Đà Phật" không bị hiểu nhầm thành "nam".
- **Tặng quà**: banner xướng tên, giọng đọc hồi hướng (lấy lời nguyện từ bình luận gần nhất của người đó nếu có), hiệu ứng theo giá trị quà, cộng điểm vào bảng Công Đức. Camera zoom vào người tặng, theo họ đi lên thảm đỏ, quỳ lạy ba lạy trước sư trụ trì, rồi lùi ra khi lễ vật bay tới tượng Phật. Mỗi lần zoom một người; tối đa hai người khác quỳ chờ tới lượt, quà lớn được zoom trước.
- **Thả tim**: tim bay trên đầu nhân vật. Mỗi 1.000 tim (chỉnh được, hoặc tắt) thì mưa hoa sen khắp chánh điện, thỉnh chuông và cảm ơn đại chúng. Thanh tiến độ tới lần mưa hoa kế tiếp nằm dưới bộ đếm Thả tim.
- **Bình luận "lời dạy"** (hay "xin lời Phật dạy"): nhận một lời Phật dạy ngắn trên banner kèm tên mình, đọc thành tiếng khi giọng đọc đang rảnh. Mỗi người 5 phút một lần; nhiều người hỏi thì 12 giây một lời.

### Hoạt cảnh

- **Kinh hành**: mỗi lần đọc kinh định kỳ, đoàn 8 vị sư và ni (cao tăng đi đầu) vào từ cột bên trái, đi xuống lối đi bên trái, vòng ra sau rồi đi lên lối bên phải và ra ở cột bên phải, mất khoảng nửa phút. Cả chánh điện cùng lạy, lần lượt từ hàng đầu xuống.
- **Hồi hướng cuối khóa lễ**: hết giờ khóa lễ, giọng đọc hồi hướng công đức, đọc tên tối đa 12 người xem đang có mặt (người mới hoạt động gần đây trước), cả chánh điện cùng lạy. Người ở lại tới cuối được nghe tên mình.
- **Chỉ nút Quà**: video live không bấm được, nên không thể có nút tặng quà trên overlay. Thay vào đó, sau mỗi lần đọc kinh một nút "🎁 Quà ↘" hiện 12 giây ở góc phải, mũi tên chỉ xuống nút Quà của TikTok; có quà tới thì dòng này tự ẩn. Muốn có món quà bấm được trên màn hình người xem thì dùng công cụ của TikTok như Mục tiêu LIVE.
- **Cỡ người**: Phật tử vẽ to hơn khoảng cách chỗ ngồi (mặc định 120%) cho chánh điện trông đông đúc.

Bảng điều khiển có nút **Kinh hành ngay**, **Thử mưa hoa sen** và **Hồi hướng ngay** để chủ động tạo cao trào hoặc thử trước khi live.

Chánh điện không đứng yên: người ngồi lần lượt đứng dậy đi lạy rồi về chỗ. Người ở giữa đi theo thảm đỏ lên sau lưng sư trụ trì. Người hai bên đi theo hai lối đi bên (chạy theo phối cảnh từ cạnh thảm đỏ ra hai mép), lên lạy trước bục dưới hai cây đèn vàng. Mức **Người đi lại** trong bảng điều khiển chọn từ yên tĩnh tới rất nhộn nhịp (mặc định nhộn nhịp: tối đa 3 người trên thảm đỏ và 4 người ở hai bên cùng lúc). Mỗi người đi chỉ thay đổi một phần nhỏ khung hình nên hình live vẫn nét.

Overlay có đồng hồ đếm ngược khóa lễ (mặc định 60 phút, hết giờ tự thỉnh chuông và đọc kinh), bộ đếm Dâng hương · Lễ Phật · Hoa sen · Thả tim, bảng giá lễ ở góc trên bên trái (hình quà TikTok: Hoa hồng 1 xu, Cỏ bốn lá 10 xu, Thả tim 100 xu) và bảng **Tấm Lòng Thành** top 3. Quà dưới 10 xu tính là Dâng hương, 10–99 xu là Lễ Phật, từ 100 xu là Hoa sen (tính theo giá một món quà).

## Bảo mật

Dự án được viết để ai tải về chạy cũng an toàn mặc định:

- **Không dùng tài khoản TikTok.** Server chỉ đọc sự kiện công khai của phòng live theo username. Không cần, không hỏi và không lưu mật khẩu, cookie hay session. Không gửi tin nhắn thay bạn.
- **Chỉ mở trên máy mình.** Server lắng nghe `127.0.0.1`, máy khác trong mạng hay Internet không truy cập được. Muốn mở ra ngoài phải tự đặt biến `HOST`. Không nên làm vậy khi chưa thêm đăng nhập.
- **Chặn trang web lạ điều khiển.** WebSocket chỉ nhận kết nối từ chính trang của server (kiểm tra `Origin`), và header `Host` phải là localhost (chống DNS rebinding). Một trang web khác đang mở trong cùng trình duyệt không gửi được lệnh. Cửa sổ overlay chỉ nhận dữ liệu và báo kích thước khung hình của nó, không gửi lệnh được.
- **File tĩnh có danh sách trắng.** Chỉ phục vụ `/assets` và `/live`. Chặn file ẩn (`.git`, `.env`), `node_modules`, mã server, `package.json` và mọi đường dẫn `../`.
- **Không tin dữ liệu vào.** Tên người xem, bình luận và tên quà đều bị cắt độ dài. Cài đặt chỉ nhận đúng khóa, đúng kiểu, trong giới hạn. Văn bản đưa vào giọng đọc được escape XML. Mọi chữ trên màn hình vẽ bằng `textContent` hoặc canvas, không chèn HTML, nên bình luận chứa mã độc chỉ hiện ra như chữ thường.
- **Chống spam.** Hàng đợi giọng đọc tối đa 15 câu. Nội dung bình luận không bao giờ được đọc thành tiếng, chỉ tên người mới vào (đã lọc ký tự lạ) được gộp lại đọc, tối đa 30 giây một câu.
- **Phụ thuộc ghim phiên bản** trong `live/package.json`: `ws`, `msedge-tts`, `tiktok-live-connector`. Không có khóa API nào trong mã.

Các lớp trên đã được thử: đường dẫn `../`, `%2e%2e`, `.git/config`, `server.mjs`, `package.json` đều trả 404. Host giả trả 421. WebSocket từ Origin lạ bị từ chối. Lệnh gửi từ overlay bị bỏ qua. Cài đặt sai kiểu bị kẹp về giới hạn.

### Lưu ý

- `tiktok-live-connector` là thư viện cộng đồng, không phải API chính thức của TikTok. Nó có thể ngừng chạy khi TikTok đổi hệ thống. Kiểm tra điều khoản TikTok trước khi dùng cho kênh của bạn.
- Giọng đọc dùng dịch vụ Read Aloud của Microsoft Edge qua mạng (giọng Nam Minh, Hoài My). Máy phát cần có Internet. Dịch vụ này hay rớt kết nối: server tự gửi lại tối đa 8 lần (hết khoảng 13 giây nếu lần nào cũng lỗi), và nếu chờ quá 2,5 giây thì gửi thêm một yêu cầu song song, cái nào xong trước dùng cái đó. Câu kinh định kỳ được lưu lại để khỏi gọi mạng. Muốn không bao giờ bỏ câu, bật **giọng dự phòng của Windows** trong bảng điều khiển (giọng "Microsoft An" có sẵn trên Windows, nghe máy hơn).
- TikTok LIVE Studio lấy tiếng của nguồn Link qua **âm thanh máy tính** (loa), nên mọi tiếng khác trên máy cũng lọt vào live. Khi live nên bật *Không làm phiền* của Windows, chọn *Power mode → Best performance*, để âm lượng âm thanh máy tính trong LIVE Studio không quá 100% và tắt micro nếu không nói.
- Hình ảnh trong `assets/` được tạo bằng Google Flow (riêng ảnh nền overlay `grand_hall.jpg` tạo bằng Figma AI), nhạc nền tạo bằng Gemini. Kiểm tra điều khoản của các dịch vụ đó trước khi dùng thương mại, hoặc thay bằng tài nguyên của bạn.

## Miễn trừ trách nhiệm

Dự án được chia sẻ **miễn phí, với mục đích học tập và tham khảo lập trình**. Phần mềm được cung cấp "nguyên trạng" (AS IS), không kèm bất kỳ bảo đảm nào, rõ ràng hay ngụ ý.

Khi tải về, sử dụng, chỉnh sửa hoặc phân phối lại mã nguồn này, **bạn tự chịu hoàn toàn trách nhiệm** về:

- Mọi nội dung bạn phát trên livestream hoặc đăng tải, bao gồm hình ảnh, âm thanh, giọng đọc, lời nguyện, bình luận được hiển thị.
- Việc nhận quà, donation hoặc bất kỳ khoản thu nào từ người xem.
- Việc tuân thủ điều khoản sử dụng của TikTok và các nền tảng, dịch vụ bên thứ ba khác (thư viện đọc sự kiện TikTok là thư viện cộng đồng, không chính thức).
- Việc tuân thủ pháp luật nơi bạn sinh sống và hoạt động, kể cả quy định về hoạt động tôn giáo, quảng cáo, thuế và bản quyền.
- Mọi rủi ro và thiệt hại phát sinh, trực tiếp hay gián tiếp, như bị khóa tài khoản, bị dừng live, mất dữ liệu, tranh chấp hay khiếu nại.

Tác giả **không liên quan, không bảo trợ và không chịu trách nhiệm** đối với bất kỳ kênh, tài khoản, sản phẩm hay hoạt động nào sử dụng mã nguồn này. Dự án không đại diện cho bất kỳ chùa, tu viện hay tổ chức tôn giáo nào. Khi dùng nội dung liên quan đến Phật giáo, xin giữ sự tôn kính và không dùng vào mục đích lừa đảo, trục lợi hay xúc phạm niềm tin của người khác.

Việc sử dụng mã nguồn đồng nghĩa với việc bạn đã đọc và đồng ý với các điều trên.

> **Disclaimer (EN):** This project is shared free of charge for educational purposes only and is provided "AS IS", without warranty of any kind. Anyone who uses, modifies or redistributes it is solely responsible for their own content, streams, donations, compliance with TikTok and other platforms' terms, and applicable laws. The author is not affiliated with, does not endorse, and accepts no liability for any channel, account, product or activity built with this code, nor for any direct or indirect damages.

## Ủng hộ tác giả

Dự án chia sẻ miễn phí. Nếu thấy hữu ích và muốn góp chút công đức để tác giả duy trì và làm thêm tính năng, bạn có thể chuyển khoản:

| | |
|---|---|
| Ngân hàng | **MB Bank** |
| Số tài khoản | **999979798886** |
| Chủ tài khoản | **HUYNH HUU NHAN** |

![QR chuyển khoản MB Bank](https://img.vietqr.io/image/MB-999979798886-compact2.png?accountName=HUYNH%20HUU%20NHAN&addInfo=Ung%20ho%20Chanh%20Dien%20Online)

Xin cảm ơn và chúc bạn thân tâm an lạc. Nam mô A Di Đà Phật.

## Giấy phép

MIT, xem `LICENSE`.
