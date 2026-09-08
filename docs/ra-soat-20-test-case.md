# Rà soát AI theo bộ 20 test case

Soát ngày 08/09/2026 trên bản thật: công cụ AI có gì, kho tri thức có gì, và
từng test case hiện trả lời được tới đâu.

**Kết quả: 12 đạt · 5 thiếu một phần · 3 chưa trả lời được.**

Điều đáng nói nhất: **phần lớn chỗ thiếu là do thiếu dữ liệu, không phải do AI
kém** — và một trong số đó là chính sách đã soạn xong nhưng **đang bị tắt**.

---

## 1. Bảng chấm từng test case

| TC | Tình huống | Trạng thái | Vướng ở đâu |
|---|---|---|---|
| 01 | Có những loại trà nào | ✅ | Đã sửa hôm nay — bản đồ danh mục 22 nhóm + công cụ `catalog_overview` |
| 02 | Trà uống hằng ngày dễ uống | ✅ | Có FAQ tư vấn gu vị + tài liệu sản phẩm |
| 03 | Giá trà xanh Thái Nguyên | ✅ | Đã sửa hôm nay — giá lấy thẳng từ FM lúc trả lời |
| 04 | So sánh hai dòng trà | ⚠️ | **54/84 sản phẩm chưa có mô tả** → so sánh nông |
| 05 | Mua 500k thì mua gì được nhiều ưu đãi | ⚠️ | Chính sách freeship + quà **đang bị TẮT** — xem mục 2 |
| 06 | Lấy 2 hộp trà F | ✅ | Công cụ `create_order`, lưu đơn nháp chờ nhân viên duyệt |
| 07 | Đặt 2 hộp, giao Thái Nguyên | ✅ | `create_order` bắt buộc tên + SĐT + địa chỉ, thiếu thì AI hỏi |
| 08 | Mua 500k được ưu đãi gì | ⚠️ | Cùng nguyên nhân TC05 |
| 09 | Mã giảm giá dùng chung với quà được không | ❌ | **Không có dữ liệu** về điều kiện cộng dồn |
| 10 | Làm sao thành hội viên | ✅ | Bài "Chương trình hội viên" có mục Cách tham gia |
| 11 | Bạc lên Vàng thế nào | ✅ | Bạc từ 10tr GMV (giảm 6%) → Vàng từ 50tr (giảm 7%) |
| 12 | Mua 1 triệu được bao nhiêu Lá | ✅ | Quy tắc rõ: 1.000đ doanh thu thực = 1 lá → 1.000 lá |
| 13 | 5.000 Lá đổi được gì | ❌ | **Không có danh sách quà và tỷ lệ quy đổi** |
| 14 | Đơn HD123456 đang ở đâu | ✅ | Đã thêm hôm nay — công cụ `lookup_order` |
| 15 | Bao giờ nhận được hàng | ✅ | `lookup_order` trả trạng thái + đơn vị vận chuyển |
| 16 | Hàng bị móp, xử lý sao | ✅ | Policy bảo hiểm 100% bể vỡ + luật chuyển nhân viên |
| 17 | Muốn trả hàng có được không | ❌ | **Không có chính sách đổi/trả/hoàn tiền** |
| 18 | Trà có chữa được bệnh không | ✅ | Guardrail rõ: chỉ nói "hỗ trợ", cấm cam kết chữa bệnh |
| 19 | Sao trà bên bạn đắt vậy | ✅ | FAQ "Vì sao giá cao hơn" + playbook xử lý từ chối |
| 20 | Hội viên Bạc + 800k + voucher 10% + Lá + quà | ⚠️ | Tính được phần hạng và Lá; kẹt ở voucher (TC09) và quà (TC13) |

---

## 2. Việc sửa được ngay trong 1 phút — chính sách đang bị tắt

Bài **"Chính sách Miễn phí vận chuyển & Quà tặng tri ân khách hàng"** đang ở
trạng thái `rejected`, nên AI **không đọc được**. Nội dung bài đó chính là câu
trả lời cho TC05 và TC08:

```
• Đơn từ 500.000đ  : Miễn phí vận chuyển toàn quốc
• Đơn từ 1.000.000đ: Miễn phí vận chuyển + tặng 01 hộp bánh kẹo TraBa
• Thời gian giao   : nội thành Hà Nội trong 24h; tỉnh khác 2–3 ngày làm việc
```

Bài này do **nhân viên tự soạn ngày 17/08**, bị chuyển sang `rejected` ngày
30/08 — cùng ngày với một đợt rà soát hàng loạt. Em **không tự bật lại**: có thể
đội ngũ cố ý tắt vì chính sách đã đổi. Anh xác nhận giúp:

- Chính sách vẫn còn hiệu lực → **bật lại**, TC05 + TC08 đạt ngay, không cần soạn gì.
- Đã đổi → soạn bài mới thay thế.

Cùng đợt đó còn **3 bài "Bộ câu hỏi về trà" phần 2, 3, 8** cũng bị tắt, nên bộ
kiến thức trà hiện chỉ còn 5/8 phần.

---

## 3. Ba chỗ thiếu dữ liệu thật — cần soạn nội dung

Không phải việc kỹ thuật. Soạn xong dán vào **AI → Kiến thức**, AI dùng được ngay.

### 3.1. Voucher và điều kiện cộng dồn (TC09, TC20)

Cần trả lời được:
- Mã giảm giá có cộng dồn với ưu đãi hội viên không?
- Có cộng dồn với quà tặng theo giá trị đơn không?
- Có cộng dồn với freeship không?
- Thứ tự áp dụng khi trùng nhiều ưu đãi?

Hiện AI **không có gì** để trả lời, và đây là câu khách hỏi rất thường.

### 3.2. Đổi quà bằng Lá (TC13)

Bài hội viên hiện chỉ nói *"Lá dùng trong các chương trình khuyến mại xuyên
suốt; không quy đổi thành tiền"*. Thiếu:
- Danh sách quà đang đổi được và số Lá mỗi món
- Điều kiện và thời hạn Lá

### 3.3. Chính sách đổi / trả / hoàn tiền (TC17)

Hiện chỉ có cam kết bảo hiểm bể vỡ ấm chén. Thiếu:
- Trường hợp nào được đổi/trả
- Thời hạn kể từ khi nhận hàng
- Ai chịu phí vận chuyển chiều về
- Thời gian hoàn tiền

Đây là chính sách bắt buộc phải có, cả về bán hàng lẫn pháp lý.

---

## 4. Việc đã sửa hôm nay

| | |
|---|---|
| **Xếp hạng tìm kiếm** | Từ "trà" khớp 71% tên sản phẩm nhưng vẫn cộng điểm đều → dìm chết từ khoá thật. Nay tính theo độ hiếm |
| **Bản đồ danh mục** | 22 dòng nạp sẵn mỗi lượt, chặn việc AI bịa số liệu và chối nhầm hàng đang bán |
| **Giá thật** | Lấy trực tiếp từ FM tại thời điểm trả lời, không dùng giá chép cứng |
| **Prompt** | 8 tài liệu — bỏ danh mục "49 SP" lỗi thời vốn dạy AI coi 45/84 sản phẩm đang bán là hàng ngừng bán |
| **`lookup_order`** | Công cụ mới — TC14, TC15 |
| **Báo lỗi model** | Không còn hiện 429 thành "Bot quyết định không trả lời" |

### Về `lookup_order` — một quyết định bảo mật

Công cụ **không nhận số điện thoại từ mô hình**. Nếu để mô hình truyền số thì chỉ
cần khách gõ *"tra đơn của số 09xx"* là xem được lịch sử mua hàng, địa chỉ và
hạng thẻ của người khác. Số luôn lấy từ hồ sơ gắn với hội thoại — danh tính do hệ
thống xác định, không phải do khách khai.

---

## 5. Chưa kiểm chứng được đầu-cuối

Hạn mức OpenAI vẫn là **30.000 TPM** — mức mới chưa ăn vì khoá đang dùng là
**khoá theo dự án** (`sk-proj-…`), mà hạn mức dự án không tự thừa hưởng từ tổ
chức. Đo trực tiếp lúc 08/09:

```
x-ratelimit-limit-tokens : 30000
```

Chừng nào chưa nâng ở **cấp dự án**, mọi thứ ở mục 4 vẫn chưa chạy được với
khách thật. Sửa ở `platform.openai.com → chọn đúng dự án → Settings → Limits`.

Xong việc đó, chạy lại 20 test case này trong khung **Demo** ở màn huấn luyện AI
là đo được ngay từng ca.

---

## 6. Thứ tự em khuyên

1. **Nâng TPM ở cấp dự án** — gỡ nút thắt, không có bước này thì không đo được gì
2. **Bật lại chính sách freeship** (nếu còn hiệu lực) — 1 phút, được thêm 2 test case
3. **Soạn 3 nội dung ở mục 3** — voucher, đổi quà, đổi trả
4. **Điền mô tả cho 54 sản phẩm còn trống** — sửa tại chỗ trong màn Sản phẩm CRM
5. Chạy lại 20 test case, ca nào chưa đạt thì gửi em
