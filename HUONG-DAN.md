# Chánh Điện Tịnh Tâm: giới thiệu và hướng dẫn sử dụng

Tài liệu này dành cho người dùng, không cần biết lập trình. Phần kỹ thuật chi tiết (bảo mật, cách giọng đọc chạy) xem trong [README.md](README.md).

## Chánh Điện Tịnh Tâm là gì

Chánh Điện Tịnh Tâm biến phòng TikTok LIVE của bạn thành một chánh điện ảo 2.5D: tượng Phật, sư trụ trì, thảm đỏ, hai hàng bồ đoàn, nhạc thiền, chuông và mõ.

Người xem không chỉ ngồi nhìn mà được tham gia:

- **Bình luận là bước vào chánh điện.** Nhân vật mang tên họ đi dọc thảm đỏ vào quỳ, bình luận hiện thành bong bóng chữ trên đầu, giọng đọc chào đón tên họ.
- **Tặng quà là dâng lễ.** Banner xướng tên, giọng đọc hồi hướng, camera theo người tặng lên lạy trước bàn thờ, tên vào bảng **Tấm Lòng Thành**.
- **Có chương trình cho mọi người cùng làm, không tốn tiền:** niệm Phật đủ 108 biến, thắp nến cầu an, xin lời Phật dạy, đố vui Phật pháp, thả tim để mưa hoa sen.
- **Chánh điện luôn động:** đọc kinh định kỳ, đoàn sư kinh hành, người đi lại lễ Phật, hồi hướng cuối mỗi khóa lễ.

Mục tiêu là giữ chân người xem lâu hơn và có nhiều tương tác hơn (bình luận, tim, theo dõi, chia sẻ). Đó cũng là những điều TikTok dựa vào để đề xuất phiên live.

### Bộ công cụ gồm ba phần

| Phần | Là gì | Mở ở đâu |
|---|---|---|
| **Server** | Bộ não, chạy trong một cửa sổ đen trên máy phát. Đóng cửa sổ này là tắt chánh điện. | Gõ `npm start` trong thư mục `live` |
| **Overlay** | Màn hình chánh điện dọc 9:16, là hình người xem thấy trên live | Nguồn **Link** trong TikTok LIVE Studio |
| **Bảng điều khiển** | Nơi bạn kết nối TikTok, chỉnh giọng đọc, bật tắt hoạt cảnh, xem nhật ký | `http://localhost:3000/live/control.html` trong Chrome |

Ngoài ra thư mục gốc còn có một bản web tĩnh (`index.html`) để mọi người tự vào ngồi tụng, không liên quan tới live.

## Cần chuẩn bị

- Máy tính Windows, có Internet (giọng đọc dùng dịch vụ của Microsoft qua mạng).
- **Node.js** bản LTS, tải ở nodejs.org.
- **TikTok LIVE Studio** (hoặc OBS).
- **Chrome** để mở bảng điều khiển.
- Thư mục `Chanh-dien`.

## Cài đặt lần đầu

1. Cài Node.js: vào **nodejs.org**, tải bản **LTS**, cài bằng cách bấm Next liên tục.
2. Mở thư mục `Chanh-dien\live`. Bấm vào thanh địa chỉ phía trên cửa sổ thư mục, xóa chữ cũ, gõ `cmd` rồi Enter. Một cửa sổ đen hiện ra, đã ở đúng thư mục.
3. Gõ lệnh sau rồi Enter, chờ 1 đến 2 phút cho máy tải thư viện:

```bash
npm install
```

Chỉ cần làm một lần. Lần sau mở máy không phải cài lại.

## Mỗi lần live

### 1. Bật chánh điện

Mở cửa sổ đen như bước 2 ở trên, gõ:

```bash
npm start
```

Thấy dòng `Server chạy tại http://localhost:3000` là được. **Để nguyên cửa sổ đen này suốt buổi live.**

### 2. Mở bảng điều khiển

Mở Chrome, vào `http://localhost:3000/live/control.html`.

Hàng chip trên cùng cho biết tình trạng:

- **Server**: đang chạy hay không.
- **TikTok**: đã kết nối chưa.
- **Số người** đang ngồi trong chánh điện.
- **Overlay**: có bao nhiêu màn hình overlay đang mở, tiếng đang phát ở đâu, kích thước đúng chưa.

### 3. Đưa chánh điện vào TikTok LIVE Studio

1. Chọn *Add source → Link* (Liên kết), dán địa chỉ `http://localhost:3000/live/overlay.html`.
2. Bật độ phân giải tùy chỉnh và đặt **1080×1920**. Để mặc định 800×600 thì hình bị phóng to gần 4 lần, rất mờ.
3. Nhìn chip **Overlay** trên bảng điều khiển. Nó phải báo tiếng ở **nguồn Link** và không cảnh báo sai kích thước.

Dùng OBS thì thêm *Browser source* với cùng địa chỉ và kích thước. Không nên dùng *Window capture* vì hình sẽ mờ và dính thanh địa chỉ.

Nút **Mở màn hình overlay 9:16** trên bảng điều khiển chỉ để xem thử. Cửa sổ đó tự im lặng khi nguồn Link đang mở, nên không bị vọng tiếng.

### 4. Kiểm tra tiếng

LIVE Studio lấy tiếng của chánh điện qua **âm thanh máy tính** (loa). Vì vậy mọi tiếng khác trên máy cũng lọt vào live. Trước khi live:

- Bật *Không làm phiền* (Do not disturb) của Windows để thông báo không kêu lên live.
- Chọn *Power mode → Best performance* để máy không giật.
- Để âm lượng **âm thanh máy tính** trong LIVE Studio không quá 100%.
- Tắt micro nếu không nói.

Để nghe thử giọng đọc, gõ một câu vào ô **Đọc thử / phát thông báo** trên bảng điều khiển rồi bấm **Phát lên live**.

### 5. Lên live và kết nối

1. Bấm bắt đầu LIVE trên TikTok **trước**.
2. Trên bảng điều khiển, nhập username kênh (ví dụ `@tenkenhcuaban`) vào ô **Username kênh đang live**, bấm **Kết nối**.
3. Chip **TikTok** chuyển sang đã kết nối và **Nhật ký** báo `Đã kết nối live`.

Chánh điện chỉ đọc sự kiện công khai của phòng live (bình luận, quà, tim, theo dõi, chia sẻ). Không cần và không bao giờ hỏi mật khẩu TikTok.

### 6. Kết thúc

Tắt LIVE trên TikTok, bấm **Ngắt** trên bảng điều khiển. Muốn tắt hẳn thì đóng cửa sổ đen.

> **Lưu ý:** chánh điện không lưu dữ liệu. Tắt cửa sổ đen hoặc khởi động lại là bảng Tấm Lòng Thành, người đang ngồi, số tim, nến và điểm đố vui về 0, và TikTok bị ngắt kết nối. Đừng khởi động lại giữa buổi live.

## Người xem tương tác thế nào

Bạn có thể đọc bảng này cho người xem, hoặc để dòng mời ở góc trái overlay tự nhắc. Dòng mời đổi gợi ý mỗi 6 giây.

| Người xem làm gì | Chánh điện phản hồi |
|---|---|
| Bình luận bất kỳ | Vào ngồi bồ đoàn (tối đa 200 chỗ), bình luận hiện trên đầu, được chào tên |
| Bình luận đúng một từ `nam`, `nữ`, `ông`, `bà`, `sư`, `ni`, `tiểu`, `cao tăng` | Đổi hình nhân vật |
| Bình luận "Nam mô ..." | Cộng vào vòng niệm Phật chung. Đủ 108 thì thỉnh chuông, mưa hoa, báo viên mãn |
| Bình luận "thắp nến" | Một ngọn nến cầu an có tên mình, cháy tới hết khóa lễ |
| Bình luận "lời dạy" | Nhận một lời Phật dạy ngắn kèm tên mình (mỗi người 5 phút một lần) |
| Bình luận A, B hoặc C khi có câu đố | Trả lời đố vui. Người đúng sớm nhất được đọc tên và lên **Bảng Trí Tuệ** |
| Thả tim | Tim bay trên đầu nhân vật. Đủ mỗi 1.000 tim thì mưa hoa sen và cảm ơn đại chúng |
| Theo dõi kênh, chia sẻ live | Được xướng tên cảm ơn |
| Ở lại lâu, còn bình luận hoặc thả tim | Sau 10, 30, 60 phút được huy hiệu 🪷, 🪷🪷, 🪷🪷🪷 trước tên |
| Tặng quà | Banner, giọng đọc hồi hướng, camera theo lên lạy, vào bảng Tấm Lòng Thành |

Đầy chỗ thì người im lặng lâu nhất mà chưa tặng quà sẽ nhường chỗ cho người mới.

## Quà tặng

Góc trên bên trái overlay có bảng giá lễ với hình quà TikTok. Quà được xếp theo giá một món:

| Giá một món | Tính là | Ví dụ |
|---|---|---|
| Dưới 10 xu | Dâng hương | Hoa hồng (1 xu) |
| 10 đến 99 xu | Lễ Phật | Cỏ bốn lá (10 xu) |
| Từ 100 xu | Hoa sen | Thả tim (100 xu) |

**Giọng đọc quà:**

- Lúc vắng, mỗi người tặng được đọc đủ câu: tên, món quà và lời nguyện. Lời nguyện lấy từ bình luận gần nhất của người đó nếu có.
- Lúc nhiều người tặng dồn dập, quà tới trong lúc đang đọc được gộp vào một câu ngắn, tối đa 6 người, nhóm theo loại quà. Ví dụ: "Phật tử Tuấn, Hùng và Mai dâng Hoa hồng, Phật tử Lan dâng Cỏ bốn lá." Lời nguyện vẫn hiện trên banner. Nhờ vậy không ai phải chờ nửa phút mới nghe tên.
- Quà từ 99 xu luôn được đọc trước, kèm lời nguyện.

Bảng **Tấm Lòng Thành** hiện 3 người tặng nhiều nhất. Nút **Xóa bảng lễ vật** trên bảng điều khiển đưa bảng này và các bộ đếm Dâng hương, Lễ Phật, Hoa sen, Thả tim về 0.

Video live không bấm được, nên không thể đặt nút tặng quà trên overlay. Thay vào đó, sau mỗi lần đọc kinh, dòng **🎁 Quà ↘** hiện 12 giây ở góc phải, mũi tên chỉ xuống nút Quà của TikTok.

## Hoạt cảnh tự động

- **Đọc kinh định kỳ** (mặc định mỗi 3 phút): giọng đọc tụng một đoạn kinh, thỉnh chuông, cả chánh điện cùng lạy. Đoàn 8 vị sư và ni kinh hành theo hai lối đi bên, mất khoảng nửa phút.
- **Khóa lễ** (mặc định 60 phút, có đồng hồ đếm ngược trên overlay): hết giờ thì thỉnh chuông, đọc kinh, **hồi hướng** đọc tên tối đa 12 người đang có mặt, các ngọn nến cùng bừng sáng rồi dọn cho khóa mới.
- **Đố vui Phật pháp** (mặc định mỗi 5 phút): câu hỏi ba đáp án, 30 giây trả lời. Có sẵn 32 câu.
- **Người đi lại**: người ngồi lần lượt đứng dậy đi lạy rồi về chỗ, ở giữa thảm đỏ và hai lối đi bên.

## Bảng điều khiển

### 1 · Kết nối TikTok LIVE

Ô username, nút **Kết nối** và **Ngắt**, nút mở overlay xem thử. Mục **Trong sân chùa** liệt kê những người đang ngồi.

### 2 · Thử tương tác

Dùng khi chưa live để xem chánh điện chạy ra sao:

- **Gửi bình luận** với tên và nội dung tự đặt. Các nút quà bên dưới tặng thử một món.
- **Đổ người mẫu** 30 đến 200: lấp chánh điện bằng người mẫu. Người xem thật không bị ảnh hưởng.
- **Làm trống toàn bộ bồ đoàn**.
- **Bot tương tác mô phỏng**: bot tự bình luận và tặng quà để thử. **Tắt bot trước khi lên live.** Bot hiện như người xem, quà của bot được đọc to và cộng vào bảng Tấm Lòng Thành, nên để bot chạy khi live là đánh lừa người xem thật.

### 3 · Giọng đọc · Nhạc · Chuông mõ

- **Giọng**: Nam Minh (nam) hoặc Hoài My (nữ). Chỉnh được **độ trầm** và **tốc độ**.
- **Đọc thử / phát thông báo**: gõ một câu, bấm **Phát lên live** để giọng đọc nói câu đó trên live.
- **Đọc kinh định kỳ ngay**, **Thỉnh chuông**, **Gõ mõ**. Chỉnh được nhịp mõ và số phút giữa hai lần đọc kinh. Bật tắt nhạc nền, tiếng mõ, đọc kinh tự động.
- **Chào tên người mới** bằng giọng đọc.
- **Giọng dự phòng của Windows**: dịch vụ giọng đọc của Microsoft đôi khi chậm hoặc lỗi. Bật ô này thì khi Microsoft lỗi liên tục, máy đọc bằng giọng có sẵn của Windows. Giọng này nghe máy hơn nhưng không bỏ câu nào.

### Cảnh

- Tên thiền đường và dòng phụ hiện trên overlay.
- **Số chỗ ngồi** (tối đa 200) và **Khóa lễ** (số phút).
- **Khung bảng chữ** (mặc định 90%): chánh điện luôn phủ kín khung hình cho nét. Điện thoại cắt bớt hai mép khi xem live, nên các bảng chữ được thu vào giữa theo tỉ lệ này. Thấy mép bảng bị mất thì chọn nhỏ hơn.
- **Người đi lại**: từ Yên tĩnh tới Rất nhộn nhịp.
- **Cỡ người**: mặc định 120% cho chánh điện trông đông đúc.
- **Người vào phòng cũng được ngồi**: bật thì người vừa vào phòng live được ngồi luôn, không cần bình luận.

### Hoạt cảnh giữ chân người xem

Các ô bật tắt kinh hành, lời dạy, hồi hướng, niệm Phật 108, thắp nến, cảm ơn theo dõi và chia sẻ, huy hiệu, dòng chỉ nút Quà. Hai ô chọn **Đố vui Phật pháp** (tắt hoặc mỗi 3, 5, 10, 15 phút) và **Mục tiêu thả tim** (mỗi 300 đến 5.000 tim).

Các nút tạo cao trào khi cần: **Kinh hành ngay**, **Thử mưa hoa sen**, **Hồi hướng ngay**, **Chỉ nút Quà ngay**, **Ra câu đố ngay**, **Thử theo dõi**, **Thử chia sẻ**.

### Khóa lễ và Nhật ký

**Bắt đầu lại khóa lễ** đưa đồng hồ đếm ngược về đầu. **Nhật ký** ghi mọi việc đang diễn ra: ai tặng gì, giọng đọc có chậm không, TikTok có mất kết nối không. Có gì lạ thì xem ở đây trước.

## Trong lúc live nên làm gì

- Mời người xem bình luận để vào chánh điện, gõ "Nam mô A Di Đà Phật" để cùng niệm, gõ "thắp nến" và "lời dạy".
- Khi phòng vắng tương tác, bấm **Ra câu đố ngay** hoặc **Kinh hành ngay** để tạo điểm nhấn.
- Liếc **Nhật ký** thỉnh thoảng. Thấy `TikTok: mất kết nối` thì bấm **Kết nối** lại.
- Không đóng cửa sổ đen, không khởi động lại giữa buổi.

## Lỗi hay gặp

| Hiện tượng | Cách xử lý |
|---|---|
| `'npm' is not recognized` | Node.js chưa cài xong, hoặc cửa sổ đen mở từ trước khi cài. Đóng đi, mở lại. |
| `running scripts is disabled` | Bạn đang gõ trong PowerShell (cửa sổ xanh). Mở `cmd` từ thanh địa chỉ thư mục như phần cài đặt. |
| `EADDRINUSE` | Chánh điện đang chạy sẵn ở một cửa sổ đen khác. Dùng cửa sổ đó, hoặc đóng nó rồi chạy lại. |
| Live mất tiếng | Xem chip **Overlay** có báo tiếng ở nguồn Link không. Tải lại nguồn Link trong LIVE Studio. Kiểm tra âm thanh máy tính trong LIVE Studio có bật không. |
| Hình mờ | Nguồn Link chưa đặt 1080×1920. |
| Mất mép bảng chữ trên điện thoại | Chọn **Khung bảng chữ** nhỏ hơn trong bảng điều khiển. |
| Giọng đọc chậm, nhật ký báo "Microsoft chậm/lỗi" | Dịch vụ của Microsoft đang chập chờn. Chánh điện tự gửi lại tối đa 8 lần. Muốn chắc chắn không bỏ câu, bật **giọng dự phòng của Windows**. |
| Không kết nối được TikTok | Phải bật LIVE trước rồi mới bấm Kết nối. Kiểm tra username. Thư viện đọc TikTok là thư viện cộng đồng, có thể ngừng chạy khi TikTok đổi hệ thống. |
| Máy nóng, tiếng rè, hình giật | Laptop nóng lâu sẽ tự hạ tốc độ, âm thanh dễ bị hụt. Cắm sạc khi live. Chọn *Power mode → Best performance*. Bật chế độ quạt mạnh trong phần mềm của hãng máy (máy ASUS: MyASUS → Fan Profile → Performance). Kê cao đáy máy hoặc dùng đế tản nhiệt. Nếu LIVE Studio cho chọn bộ mã hóa (encoder), chọn loại phần cứng (Intel Quick Sync, Hardware) thay vì x264. Tắt bớt chương trình khác. |

## Lưu ý quan trọng

- Đây là **kênh thiền tịnh giải trí, không phải chùa thật**. Đừng xưng là chùa hay đại diện tổ chức tôn giáo nào.
- Đừng hứa hẹn phước báu, may mắn hay điều ước thành hiện thực để đổi lấy quà. Quà là người xem ủng hộ kênh.
- Không dùng bot khi đang live.
- Giữ sự tôn kính khi dùng nội dung Phật giáo.
- Bạn tự chịu trách nhiệm về nội dung phát và quà nhận được. Xem phần Miễn trừ trách nhiệm trong [README.md](README.md).

Nam mô A Di Đà Phật.
