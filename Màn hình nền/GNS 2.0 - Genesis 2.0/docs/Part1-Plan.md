# Phần 1 — Kế hoạch chi tiết
> 2026-03-31

---

## ĐIỀU KIỆN TIÊN QUYẾT (Phải có trước khi cài GNS 2.0)

GNS 2.0 **không tự cài AI CLI** — nó chỉ là lớp kết nối Telegram vào các CLI có sẵn. Vì vậy máy người dùng phải có ít nhất 1 trong 2 CLI sau:

### Claude Code CLI
- Cài: `npm install -g @anthropic-ai/claude-code`
- Kiểm tra: `claude --version`
- Yêu cầu: có tài khoản Anthropic, đã chạy `claude` ít nhất 1 lần để auth

### Gemini CLI
- Cài: `npm install -g @google/gemini-cli`
- Kiểm tra: `gemini --version`
- Yêu cầu: có tài khoản Google, đã chạy `gemini` ít nhất 1 lần để auth

### Xử lý trong install.sh
Script cài đặt sẽ **tự kiểm tra** CLI nào có sẵn trên máy:
- Nếu cả 2 đều có → cho chọn dùng cái nào
- Nếu chỉ có 1 → dùng cái đó, bỏ qua cái kia
- Nếu không có cái nào → **dừng lại**, hiện hướng dẫn cài, không tiếp tục setup

Người dùng không cần cài cả 2 — chỉ cần 1 là đủ.

### Không hỗ trợ OpenClaw trong Phần 1
OpenClaw là agent server riêng — đã có Telegram, session memory, và gateway API của nó. Tích hợp vào GNS 2.0 sẽ tạo 2 lớp trùng nhau, làm phức tạp không cần thiết. Giữ lại để nghiên cứu ở Phần 2 hoặc Phần 3.

---

## MỤC TIÊU PHẦN 1

Xây dựng hệ thống cho phép nhắn tin với AI qua Telegram, trong đó:

- **AI nhớ được lịch sử** — tắt máy bật lại vẫn nhớ, không bị reset
- **Hỗ trợ 2 loại AI** — Claude Code CLI và Gemini CLI, mỗi loại hoạt động khác nhau nên cần xử lý riêng
- **Tự bảo vệ dữ liệu** — khi cuộc trò chuyện quá dài, tự động lưu lại trước khi bị xóa
- **Có giao diện web** — không cần vào terminal mới quản lý được

---

## BƯỚC 1 (P1.3) — Xây dựng phần nền móng chung

Đây là tầng thấp nhất, không trực tiếp liên quan đến Telegram hay giao diện. Nhiệm vụ của nó là lo các việc cơ bản: đọc ghi file, theo dõi trạng thái, ghi log. Cả bot lẫn web sau này đều gọi vào đây.

---

### 1a. Quản lý cấu hình

**Vấn đề cần giải quyết:**
Mỗi agent (bot) cần lưu thông tin riêng — token Telegram, dùng AI nào, ai được phép nhắn... Những thông tin này phải tồn tại lâu dài trên máy, không bị mất khi tắt chương trình.

**Cách làm:**
Lưu vào file JSON trên máy, mỗi agent một file riêng tại `~/.config/gns2/agents/`. Ngoài ra có một file cấu hình chung (`config.json`) chứa port web và thông tin đăng nhập.

**Thông tin lưu cho mỗi agent:**
- Tên agent (dùng để đặt tên file, nhận diện trong log)
- Dùng Claude hay Gemini
- Token Telegram của bot đó
- Danh sách Telegram user ID được phép nhắn (những người khác bị chặn)
- Session ID — một mã định danh cố định, dùng để tìm lại lịch sử hội thoại
- Thư mục làm việc (để Claude biết lưu session ở đâu)
- Giới hạn số lượt AI được phép làm (chỉ Claude dùng)
- Thời gian tối đa chờ AI trả lời trước khi báo lỗi

**Kết quả:** Có thể tạo, sửa, xóa, đọc cấu hình agent bất kỳ lúc nào.

---

### 1b. Quản lý session (trí nhớ của AI)

**Vấn đề cần giải quyết:**
Claude và Gemini lưu trữ lịch sử hội thoại theo 2 cách hoàn toàn khác nhau.

**Với Claude:**
Claude tự lưu lịch sử vào file `.jsonl` trên máy, tại đường dẫn cố định theo thư mục làm việc. Khi gọi lại với cùng session ID, Claude tự đọc file đó và nhớ lại mọi thứ. Phần này chỉ cần biết file đó nằm ở đâu và kiểm tra nó có tồn tại không để quyết định resume hay tạo mới.

**Với Gemini:**
Gemini không lưu gì cả. Mỗi lần gọi là một cuộc trò chuyện hoàn toàn mới, Gemini không biết trước đó đã nói gì. Vì vậy phần này phải tự tạo và duy trì file lịch sử riêng cho Gemini. Mỗi lần người dùng nhắn tin, đọc lịch sử ra, chèn vào đầu prompt rồi mới gọi Gemini — nhờ vậy Gemini "thấy" được cuộc trò chuyện trước dù thực ra nó không nhớ gì.

**Ngoài ra:** Đếm xem hiện có bao nhiêu tin nhắn trong session, file đang nặng bao nhiêu. Thông tin này dùng cho bước backup bên dưới.

---

### 1c. Tự động backup trước khi mất dữ liệu

**Vấn đề cần giải quyết:**
Claude có giới hạn context window (bộ nhớ làm việc). Khi cuộc trò chuyện quá dài, Claude sẽ tự "compact" — tức là tóm tắt lại và xóa bớt lịch sử cũ. Nếu không backup kịp, những gì đã nói sẽ mất vĩnh viễn.

**Khi nào cần backup:**
Kiểm tra mỗi lần nhận tin nhắn mới. Nếu session đã có trên 80 tin nhắn hoặc file vượt quá 500KB thì coi là "sắp đầy" và cần backup ngay.

**Quy trình backup:**
1. Đọc toàn bộ file session (JSONL thô)
2. Chuyển đổi sang định dạng Markdown dễ đọc — mỗi tin nhắn hiển thị rõ ai nói, lúc mấy giờ, nội dung gì
3. Lưu file vào thư mục `session-backup/` trong workspace GNS 2.0
4. Đặt tên file theo chuẩn: `{TênAgent}_{8 ký tự đầu của SessionID}_{ngày_giờ}.md`
   - Ví dụ: `claude-bot_abc12345_2026-03-31_15-30.md`
   - Nhìn vào tên file là biết của bot nào, session nào, lúc nào
5. Sau khi backup xong, tạo session ID mới để bắt đầu cuộc trò chuyện mới (session cũ đã được lưu lại an toàn)

**Kết quả:** Không bao giờ mất dữ liệu. Mọi cuộc trò chuyện đều được lưu lại trước khi bị xóa.

---

### 1d. Ghi log

**Vấn đề cần giải quyết:**
Khi hệ thống chạy nền, nếu có lỗi xảy ra hoặc muốn biết bot đang làm gì, không có cách nào biết nếu không có log.

**Cách làm:**
Mỗi agent có một file log riêng tại `~/.config/gns2/logs/`. Mọi sự kiện đều được ghi vào đó kèm thời gian: nhận tin nhắn, gọi AI, backup, lỗi xảy ra... Định dạng đơn giản, dễ đọc bằng mắt thường.

---

### Kiểm tra Bước 1 xong chưa:
- Tạo cấu hình agent mới → file xuất hiện đúng chỗ
- Đọc lại cấu hình → dữ liệu đúng, không mất
- Trỏ vào session Claude thật → đọc được số tin nhắn
- Thêm tin nhắn vào lịch sử Gemini → đọc lại đúng thứ tự
- Tạo session giả có 85 tin nhắn → `shouldBackup()` trả về true
- Chạy backup → file `.md` xuất hiện trong `session-backup/` đúng tên đúng nội dung

---

## BƯỚC 2 (P1.4) — Xây dựng con bot Telegram

Đây là phần trực tiếp nhận tin nhắn từ người dùng và trả lời. Dùng thư viện Telegraf để kết nối với Telegram API theo kiểu long-polling (bot tự hỏi Telegram "có tin nhắn mới không?" mỗi vài giây — không cần mở port, không cần domain).

---

### 2a. Bộ chuyển đổi gọi CLI

**Vấn đề cần giải quyết:**
Claude và Gemini được gọi theo 2 cách hoàn toàn khác nhau từ terminal. Cần một lớp trung gian để phần bot không cần quan tâm đang dùng AI nào — cứ đưa tin nhắn vào, nhận kết quả ra.

**Claude — cách hoạt động:**
Gọi lệnh `claude` với flag `--resume SESSION_ID` để nối tiếp cuộc trò chuyện cũ. Claude tự đọc file session của nó, tự nhớ context. Nếu là session hoàn toàn mới (file chưa tồn tại) thì dùng `--session-id SESSION_ID` thay vì `--resume`. Ngoài ra truyền thêm các flag: chạy không cần confirm permission, giới hạn số lượt xử lý, lấy output dạng text thuần.

**Gemini — cách hoạt động:**
Gọi lệnh `gemini -p "..."` với toàn bộ prompt bao gồm lịch sử. Cụ thể:
- Đọc 20 tin nhắn gần nhất từ file lịch sử Gemini (đã tạo ở Bước 1b)
- Xây dựng một prompt dài hơn, có dạng: *"Đây là lịch sử cuộc trò chuyện: [User nói...] [Gemini trả lời...] ... Bây giờ người dùng hỏi: [tin nhắn mới]"*
- Gọi Gemini với prompt đó
- Sau khi có câu trả lời, lưu cả tin nhắn người dùng lẫn câu trả lời vào file lịch sử để lần sau dùng

Nhờ cách này, dù Gemini không có bộ nhớ thật sự, nó vẫn "thấy" ngữ cảnh và trả lời như thể đang nhớ.

---

### 2b. Con bot Telegram

**Luồng xử lý khi nhận tin nhắn:**

1. **Kiểm tra quyền** — Telegram ID của người nhắn có trong danh sách `allowedUsers` không? Nếu không thì im lặng, không phản hồi gì cả.

2. **Kiểm tra session có sắp đầy không** — Gọi hàm từ Bước 1c. Nếu cần backup: thực hiện backup ngay, tạo session mới, ghi log việc này.

3. **Hiện trạng thái "đang gõ"** — Gửi tín hiệu typing lên Telegram (thấy ba chấm ...) trong lúc AI đang xử lý, tránh người dùng tưởng bot chết.

4. **Gọi AI** — Chuyển tin nhắn qua bộ chuyển đổi (Claude hoặc Gemini tùy cấu hình agent). Chờ kết quả.

5. **Gửi kết quả** — Nếu câu trả lời dưới 4096 ký tự thì gửi một lần. Dài hơn thì tự cắt ra gửi nhiều đoạn. Thử gửi dạng Markdown trước (để bold, code block hiển thị đẹp), nếu lỗi thì gửi lại dạng text thường.

6. **Xử lý lỗi** — Nếu AI trả lời lỗi hoặc quá giờ, gửi thông báo lỗi lên Telegram thay vì im lặng.

**Các lệnh người dùng có thể dùng:**
- `/new` — Xóa session hiện tại, bắt đầu cuộc trò chuyện mới hoàn toàn. Trước khi xóa sẽ backup lại.
- `/status` — Hiện thông tin: đang dùng Claude hay Gemini, session ID là gì, đã có bao nhiêu tin nhắn.
- `/backup` — Backup ngay lập tức mà không cần đợi đầy. Hữu ích khi muốn lưu lại một cuộc trò chuyện quan trọng.
- `/help` — Liệt kê các lệnh trên.

---

### 2c. Quản lý nhiều bot cùng lúc

**Vấn đề cần giải quyết:**
Có thể có nhiều agent chạy song song — ví dụ một bot Claude cho công việc, một bot Gemini để nghiên cứu. Cần một nơi quản lý tất cả, biết cái nào đang chạy, cái nào đang tắt.

**Cách làm:**
Một module trung tâm giữ danh sách tất cả bot đang chạy. Có thể khởi động hoặc dừng từng bot riêng lẻ, hoặc khởi động/dừng tất cả cùng lúc. Web UI sau này gọi vào đây để bật/tắt bot.

---

### Kiểm tra Bước 2 xong chưa:
- Nhắn tin trên Telegram → Claude trả lời đúng nội dung
- Nhắn lần 2 → Claude nhớ lần 1 (không hỏi lại thông tin đã biết)
- Tắt chương trình, bật lại → nhắn tin → Claude vẫn nhớ
- Nhắn tin trên Telegram → Gemini trả lời đúng nội dung
- Nhắn lần 2 → Gemini nhớ lần 1 (nhờ context injection)
- Nhắn đủ 80 tin → bot tự backup, file xuất hiện trong `session-backup/`, tiếp tục trả lời bình thường
- Gõ `/new` → bot báo đã reset, nhắn tiếp → không còn nhớ chuyện cũ
- Gõ `/backup` → bot báo backup xong, file xuất hiện đúng chỗ
- Nhắn từ tài khoản Telegram khác (không trong allowedUsers) → bot không phản hồi

---

## BƯỚC 3 (P1.5) — Tạo trang web quản lý

**Mục tiêu:** Nhìn vào một trang web là biết toàn bộ hệ thống đang như thế nào, không cần chạm vào terminal.

**Kỹ thuật:** Express.js làm backend API, HTML + JavaScript thuần làm giao diện — không cần build, không cần framework, mở file lên là chạy được.

**Đăng nhập:** Trang web yêu cầu đăng nhập bằng username + password đã đặt lúc setup. Sau khi đăng nhập nhận token, dùng token đó cho các request tiếp theo.

---

**Tab 1 — Agents (Quản lý bot)**

Hiện danh sách tất cả agent đã tạo. Mỗi agent hiện:
- Tên và đang dùng Claude hay Gemini
- Trạng thái: đang chạy (xanh) hay đang tắt (xám)
- Nút "Start" / "Stop" để bật tắt trực tiếp từ trình duyệt

---

**Tab 2 — Sessions (Trạng thái bộ nhớ)**

Hiện trạng thái session hiện tại của từng agent:
- Session ID đang dùng
- Đã có bao nhiêu tin nhắn
- File session đang nặng bao nhiêu KB/MB
- Mức độ đầy so với ngưỡng backup (ví dụ: 65/80 tin nhắn)

---

**Tab 3 — Backups (Lịch sử đã lưu)**

Hiện danh sách tất cả file backup đã tạo, sắp xếp theo thời gian mới nhất lên đầu. Mỗi file hiện:
- Tên file (chứa tên agent + thời gian)
- Dung lượng file
- Nút "Xem" → mở ra đọc toàn bộ nội dung cuộc trò chuyện đó

---

**Tab 4 — Logs (Nhật ký hoạt động)**

Dropdown chọn agent muốn xem log. Hiện 50 dòng log gần nhất, tự cập nhật mỗi 5 giây. Giúp theo dõi bot đang làm gì, có lỗi không mà không cần SSH vào máy.

---

### Kiểm tra Bước 3 xong chưa:
- Mở trình duyệt → thấy trang đăng nhập
- Đăng nhập sai → bị từ chối
- Đăng nhập đúng → vào được dashboard
- Tab Agents: thấy đủ các bot, bật tắt được
- Tab Sessions: số liệu hiển thị đúng với thực tế
- Tab Backups: thấy file backup, click xem được nội dung
- Tab Logs: hiện log, đợi 5 giây → tự cập nhật

---

## BƯỚC 4 (P1.6) — Ghép tất cả lại và chạy thử

**Một lệnh duy nhất để khởi động:**
Chạy `node src/index.js` là toàn bộ hệ thống khởi động: web server lên, tất cả bot kết nối Telegram, sẵn sàng nhận tin nhắn.

**Script setup lần đầu:**
Người dùng mới chạy `node config/setup.js` một lần để:
- Tạo các thư mục cần thiết
- Đặt port cho web UI
- Đặt username + password đăng nhập web
- Hướng dẫn tạo agent đầu tiên

**Tắt hệ thống sạch sẽ:**
Khi bấm Ctrl+C hoặc hệ thống nhận lệnh tắt, các bot disconnect khỏi Telegram một cách có trật tự trước khi tắt — không để Telegram bị treo kết nối rác.

**Test thực tế:**
- Chạy toàn bộ hệ thống từ lệnh duy nhất → không lỗi
- Claude bot và Gemini bot cùng chạy song song, không xung đột
- Web UI hiển thị cả 2 bot đang chạy
- Tắt hẳn máy, bật lại, chạy lại lệnh → bot nhớ cuộc trò chuyện cũ
- Giả lập tắt đột ngột (kill process) → session file vẫn còn nguyên, mở lại resume được

---

## BƯỚC 5 (P1.7) — Viết báo cáo tổng kết Phần 1

Sau khi mọi thứ chạy được, viết file `docs/Part1-Report.md` ghi lại đúng thực tế:
- Hệ thống hoạt động như thế nào (có thể khác với kế hoạch ban đầu)
- Hướng dẫn cài đặt và sử dụng từ đầu
- Những quyết định thiết kế quan trọng và lý do tại sao chọn như vậy
- Những vấn đề đã gặp phải trong quá trình làm và giải quyết ra sao
- Những điểm còn hạn chế, chưa hoàn hảo
- Gợi ý cho Phần 2 nên làm gì

**Mục đích:** 3 tháng sau mở ra vẫn hiểu ngay, không cần hỏi lại. AI session mới đọc vào là biết đủ context để tiếp tục.

---

## PHẦN 1 COI LÀ HOÀN THÀNH KHI:

- [ ] Nhắn Telegram → Claude trả lời, nhắn lần 2 → còn nhớ lần 1
- [ ] Nhắn Telegram → Gemini trả lời, nhắn lần 2 → còn nhớ lần 1
- [ ] Tắt máy, bật lại → cả 2 bot vẫn nhớ cuộc trò chuyện cũ
- [ ] Đến tin thứ 80 → tự backup → file xuất hiện đúng chỗ → tiếp tục bình thường
- [ ] Mở web → thấy bot, bật/tắt được, xem backup được, xem log được
- [ ] Báo cáo Phần 1 viết xong, đúng thực tế

---

*Kế hoạch bởi: claude-code | 2026-03-31*
