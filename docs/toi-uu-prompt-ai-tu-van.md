# Tối ưu AI tư vấn — chẩn đoán và phương án

Viết sau khi đọc lại hội thoại thật ngày 08/09/2026 và đo dữ liệu 8.552 tin nhắn
của nhân viên so với 425 tin của AI trên bản thật.

---

## 1. Ba vấn đề anh nêu — nguyên nhân thật là gì

| Vấn đề anh nêu | Nguyên nhân | Thuộc về |
|---|---|---|
| Dữ liệu sản phẩm dập khuôn, chỉ đúng vài loại | Cách chấm điểm tìm kiếm sai | **Mã** — đã sửa |
| Tư vấn quá dài dòng | Tiêu chí đang **bắt buộc** hỏi cuối mỗi tin + cho dùng gạch đầu dòng | **Prompt** — mục 3 |
| Chưa đúng trọng tâm | Cả hai nguyên nhân trên cộng lại | Cả hai |

### 1.1. Lỗi nặng nhất: AI từ chối bán hàng của chính công ty

Trong hội thoại thật:

> **Khách:** "a thấy bên em có nhiều trà xanh lắm mà, bên em chuyên trà thái nguyên mà sao bảo k có"
>
> **AI:** "riêng các loại chè xanh truyền thống chuẩn vị lá (móc câu, nõn tôm…) thì tạm thời **chưa lên hàng** trong catalog hiện tại"

Công ty **đang bán** Trà Móc Câu (30.000đ và 150.000đ), Trà Búp Mộc, Trà Đinh
Ngọc, Mạn Thái Trà. AI nói không có vì **nó thật sự không tìm thấy** — không
phải vì prompt sai.

Nguyên nhân trong mã, đã sửa:

- Mọi từ được cộng điểm đều nhau, mà từ **"trà" khớp 71% tên sản phẩm** nên nó
  cộng cho gần hết danh mục, dìm chết từ "móc câu" vốn chỉ khớp 2 sản phẩm.
- Điểm từ mô tả được cộng dồn. Mà **chỉ 30/84 sản phẩm có mô tả, toàn hộp quà và
  combo** — nên chúng luôn thắng 54 sản phẩm mô tả trống, tức là toàn bộ trà rời.

Đo lại sau khi sửa, bằng đúng câu khách đã hỏi:

| Khách hỏi | Trước | Sau |
|---|---|---|
| "trà móc câu" | Vạn Phúc Song Trà | **Trà Móc Câu Ngon** 100g / 500g |
| "a xem trà dây tuyết" | (sai) | **Trà dây tuyết 100G — 80.000đ** |
| "trà đinh ngọc" | Chè Lam Matcha | **3 quy cách Trà Đinh Ngọc** |
| "shop có bán xe máy không" | 5 sản phẩm bừa | (rỗng — để AI nói sẽ kiểm tra) |

### 1.2. AI bịa số liệu vì không có bản đồ danh mục

> **AI:** "Trà xanh Thái Nguyên & hồng trà (**17 loại**…); Trà dược (**6 loại**…);
> combo & hộp trà biếu (**15 mẫu**)"

Những con số này **không có trong dữ liệu nào**. Câu "bên mình có những loại trà
nào" không chứa từ khoá để tìm, nên hàm tìm trả rỗng và mô hình tự bịa.

Đã thêm **bản đồ danh mục** vào ngữ cảnh — 22 dòng, mỗi nhóm kèm số lượng, khoảng
giá thật và vài tên tiêu biểu:

```
- Trà › VẠN THỌ TRÀ: 7 sản phẩm · 80.000đ–435.000đ. Ví dụ: Vạn Thọ Trà - Túi Kraft 100g…
- Trà › TRÀ MÓC CÂU: 2 sản phẩm · 30.000đ–150.000đ. Ví dụ: Trà Móc Câu Ngon - Túi Zip 100g…
- Trà › TRÀ ĐINH NGỌC: 3 sản phẩm · 500.000đ–1.000.000đ…
```

Kèm câu lệnh: dòng hàng có trong bản đồ là **CÓ BÁN**, không được nói "chưa có";
chưa rõ chi tiết thì nói sẽ kiểm tra.

---

## 2. Số liệu: AI đang viết khác hẳn nhân viên

Đo trên bản thật, 30 ngày:

| | Nhân viên (8.552 tin) | AI (425 tin) | Chênh |
|---|---|---|---|
| Độ dài trung vị | 384 ký tự | 311 ký tự/lượt | tương đương |
| Số dòng mỗi tin | 4,0 | 2,2 | — |
| **Kết thúc bằng câu hỏi** | **18%** | **48%** | **gấp 2,7 lần** |
| **Dùng gạch đầu dòng** | **1%** | **27%** | **gấp 27 lần** |

Nhân viên thật viết như nói chuyện:

> "dạ chắc anh dùng là trà móc câu nên mới bị đắng nhiều như v"
>
> "Anh Thanh muốn lấy trà nào để em gửi anh nhé ạ"
>
> "dạ em lên đơn liền, em cảm ơn anh nhiều ạ"

Còn AI trả lời như tờ rơi: ba khối gạch đầu dòng, mỗi khối 3 dòng, kết bằng hai
câu hỏi lựa chọn. **Cảm giác "dài dòng, không trọng tâm" đến từ đây**, chứ không
phải từ tổng số ký tự.

Và đây không phải lỗi mô hình — **tiêu chí hiện tại đang bắt nó làm vậy**:

> `criteria` dòng 1: "Cuối mỗi tin nhắn tư vấn **BẮT BUỘC** có một câu hỏi dẫn dắt"

---

## 3. Đề xuất sửa — ba tài liệu trong màn AI

### 3.1. `criteria` — sửa quy tắc câu hỏi và định dạng

**Thay đoạn hiện tại:**

> Tuyệt đối không chỉ trả lời thông tin rồi ngắt câu. Cuối mỗi tin nhắn tư vấn
> BẮT BUỘC có một câu hỏi dẫn dắt…

**Bằng:**

```
## Độ dài và nhịp trả lời

- Mặc định 2–4 câu, dưới 400 ký tự. Khách hỏi một ý thì trả lời một ý.
- KHÔNG dùng gạch đầu dòng khi tư vấn thường. Nhân viên thật gần như không
  dùng (1% số tin) — viết như đang nhắn cho khách, không phải soạn tờ rơi.
  Chỉ dùng danh sách khi khách hỏi thẳng "có những loại nào" và cần liệt kê,
  tối đa 5 dòng, mỗi dòng một cụm ngắn.
- Giới thiệu tối đa 2 sản phẩm mỗi lượt. Ba lựa chọn trở lên làm khách phân
  vân rồi im lặng, chứ không giúp khách chọn nhanh hơn.

## Câu hỏi cuối tin

- Chỉ hỏi khi câu trả lời THẬT SỰ phụ thuộc vào thông tin còn thiếu.
  Tối đa 1 câu hỏi, ngắn.
- KHÔNG hỏi khi: khách đã nêu rõ tên sản phẩm; khách vừa hỏi giá (báo giá
  rồi mời chốt); khách đang xem ảnh; khách đã trả lời câu đó rồi.
- Không hỏi hai câu liên tiếp trong cùng một lượt.
- Khách nói "xem X" hoặc "còn loại nào khác" → đưa thẳng thông tin, không
  hỏi lại để phân loại.
```

### 3.2. `persona` và `tools` — bỏ danh mục chép cứng đã lỗi thời

Hai tài liệu này đang liệt kê tay danh mục sản phẩm:

> `tools`: "Tra cứu danh mục **49 sản phẩm**…"
> `persona`: "Chè Móc câu, Chè Nõn tôm, Chè Đinh nõn (cỡ túi zip **250g/500g**)…"

Thực tế hiện tại là **84 sản phẩm**, và tên trong hệ thống là *"Trà Móc Câu Ngon
- Túi Zip 100g - Hàn Nhiệt"*, không có quy cách 250g. Chép cứng như vậy gây hai
hại: mô hình gọi sai tên hàng, và khi tìm không ra thì nó tin vào danh sách chép
cứng rồi nói lệch với dữ liệu thật.

**Đề nghị:** xoá toàn bộ phần liệt kê sản phẩm trong `persona` và `tools`, thay
bằng một câu:

```
Danh mục sản phẩm KHÔNG chép trong tài liệu này. Mỗi lượt trả lời, hệ thống
đã nạp sẵn "Toàn bộ danh mục đang bán" và "Tài liệu bán hàng" vào ngữ cảnh —
chỉ dùng đúng những gì có ở đó. Không nhớ danh mục theo trí nhớ.
```

Nhờ vậy thêm hay bớt sản phẩm bên FM là AI biết ngay, không phải sửa tài liệu.

Phần đáng giữ trong `persona` là **giọng điệu và vai trò** — chỗ đó viết tốt.

### 3.3. Bổ sung: quy tắc chốt đơn

Đã đưa vào mã (mục "Kỷ luật khi tư vấn bán hàng"), nhưng nên nhắc lại trong
`playbook` để đội ngũ nhìn thấy và tự chỉnh:

```
Khách có tín hiệu mua (hỏi giá lần hai, hỏi ship, hỏi còn hàng, nói "lấy",
"đặt") → chốt luôn trong cùng lượt: xác nhận tên sản phẩm + quy cách + giá,
rồi xin TÊN, SỐ ĐIỆN THOẠI, ĐỊA CHỈ. Không hỏi thêm về gu vị hay nhu cầu nữa.
```

---

## 4. Viết lại thử một lượt trả lời thật

**Khách:** "Trà xanh Thái Nguyên giá bao nhiêu?"

**AI hiện tại** (438 ký tự, 2 khối gạch đầu dòng, kết bằng câu hỏi ba nhánh):

> Dạ anh Tuấn ơi, bên em hiện có một số sản phẩm trà xanh Thái Nguyên như sau:
> • Trà Hoa Trà Xanh (túi 100g – 300.000đ): đây là loại làm từ nụ hoa trà xanh…
> • Trà xanh bông sen (88.000đ/bông): trà xanh Thái Nguyên ướp nguyên bông sen…
> Anh muốn em gửi hình ảnh và tư vấn kỹ hơn về loại nào trong hai dòng này, hay
> mình muốn tìm vị đậm truyền thống đúng phong cách chè xanh Thái Nguyên để em
> gửi tiếp cho anh lựa chọn ạ?

**Theo phương án này** (176 ký tự):

> Dạ trà xanh Thái Nguyên bên em có Trà Móc Câu 100g 30.000đ và 500g 150.000đ,
> loại truyền thống uống hằng ngày ạ. Cao cấp hơn thì có Trà Đinh Ngọc 200g
> 1.000.000đ. Anh lấy loại nào để em gửi ạ?

Ngắn hơn 60%, gọi đúng tên hàng chủ lực, và kết bằng một câu mời chốt thay vì
câu hỏi phân loại.

---

## 5. Cách áp dụng và đo lại

**Áp dụng:** vào **AI → Huấn luyện**, sửa ba tài liệu `criteria`, `persona`,
`tools` theo mục 3. Đây là tài liệu đội ngũ tự chỉnh, em cố ý **không tự sửa** —
giọng điệu bán hàng là quyết định của anh, không phải của kỹ thuật.

**Đo lại sau 3–5 ngày** bằng chính hai chỉ số ở mục 2:

```sql
select case when ai_generated then 'AI' else 'Nhân viên' end as nguoi,
       round(100.0 * count(*) filter (where rtrim(content) like '%?') / count(*)) as pct_ket_bang_hoi,
       round(100.0 * count(*) filter (where content ~ '•|^- ') / count(*)) as pct_gach_dau_dong,
       percentile_cont(0.5) within group (order by length(content))::int as do_dai_trung_vi
from messages
where sender_type='self' and content_type='text' and length(content) > 20
  and sent_at > now() - interval '5 days'
group by 1;
```

Mục tiêu: AI về gần nhân viên — **kết bằng câu hỏi dưới 25%**, **gạch đầu dòng
dưới 5%**, độ dài trung vị 250–400 ký tự.

**Kiểm tra ngay được:** mở một hội thoại Web Chat thử nghiệm, hỏi lần lượt
"trà móc câu", "bên mình có những loại trà nào", "trà xanh Thái Nguyên giá bao
nhiêu". Cả ba phải ra đúng tên hàng thật, không còn câu "chưa có trong danh mục".

---

## 6. Việc còn tồn ảnh hưởng tới chất lượng tư vấn

- **54/84 sản phẩm chưa có mô tả bán hàng.** AI chỉ có tên và giá nên tư vấn
  nông. Đây là việc soạn nội dung, không phải việc kỹ thuật — sửa được ngay
  trong màn Sản phẩm CRM, bấm vào dòng là sửa tại chỗ.
- **0/84 sản phẩm có từ khoá/tên gọi khác.** Khách gọi "chè đinh", "trà nõn
  tôm", "trà sạch Thái Nguyên" thì tìm không ra. Điền ô "Từ khoá / tên gọi khác"
  sẽ tăng độ trúng rõ rệt.
- **26/84 sản phẩm chưa có ảnh** — xem `de-nghi-sua-api-anh-fm.md`.
