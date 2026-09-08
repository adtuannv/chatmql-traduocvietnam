# Đề nghị sửa phần ảnh sản phẩm — API FM

Gửi bạn phụ trách hệ thống FM.

Bên ChatMQL đang lấy danh mục sản phẩm qua `GET /api/products/external/list` để
nhân viên sale gửi cho khách qua Zalo. Phần dữ liệu chữ (mã, tên, giá, đơn vị,
danh mục) **rất tốt, dùng thẳng được, không phải sửa gì**.

Riêng phần ảnh thì đang có vấn đề khiến ảnh không hiển thị được cho khách. Tài
liệu này nêu số liệu đo được, và đề nghị đổi sang một cấu trúc chuẩn.

---

## 1. Hiện trạng — số liệu đo lúc 08/09/2026

Gọi thật vào `https://apifm.traduoc.vn/api/products/external/list?limit=500`:

| Chỉ số | Giá trị |
|---|---|
| Số sản phẩm | 84 |
| **Kích thước cả gói JSON** | **19,2 MB** |
| Trong đó riêng ảnh chiếm | **19,1 MB** (99,5%) |
| Sản phẩm có ảnh | 58/84 (26 sản phẩm chưa có ảnh) |
| Ảnh dạng `data:` base64 | 58 |
| Ảnh dạng đường dẫn HTTPS | **0** |
| Ảnh nhỏ nhất / trung vị / lớn nhất | 54 KB / **158 KB** / **2.721 KB** |
| Số ảnh tối đa mỗi sản phẩm | **1** (chỉ có trường `image_url`) |

Nghĩa là mỗi bản ghi sản phẩm đang mang theo nguyên tấm ảnh nhúng thẳng vào JSON:

```json
{
  "code_product": "BK/TP-KV01-200",
  "name_product": "Kẹo Vừng Ta - 200g",
  "price": 100000,
  "image_url": "data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAASABIAAD/4QCA…"
}
```

Chuỗi `image_url` của riêng sản phẩm này dài **148.175 ký tự**.

---

## 2. Ba vấn đề việc này gây ra

### 2.1. Ảnh không hiện được cho khách trên Zalo — lỗi nặng nhất

Ảnh nhúng base64 **không có tên tệp, do đó không có đuôi tệp**. Mà Zalo quyết
định hiện ảnh hay hiện thẻ đính kèm dựa vào **đuôi tệp**, không phải nội dung.

Kết quả là khách nhận được một thẻ tệp xám phải bấm tải về:

```
📎  2Q==
    132.21 KB                    [ mở thư mục ]  [ tải xuống ]
```

`2Q==` chính là mấy ký tự cuối của chuỗi base64. Đây là lỗi thật đã xảy ra với
khách, không phải giả định.

### 2.2. Gói dữ liệu nặng gấp ~350 lần mức cần thiết

19,2 MB cho 84 sản phẩm. Nếu chỉ trả đường dẫn ảnh thì cùng danh mục đó chỉ còn
khoảng **55 KB**. Hệ quả: mỗi lần mở màn sản phẩm là tải lại gần 20 MB, chậm cho
nhân viên và tốn băng thông cho cả hai bên. Với danh mục vài trăm sản phẩm thì
gói sẽ vượt giới hạn và hỏng hẳn.

Ảnh lớn nhất hiện tại là **2,7 MB cho một tấm** — ảnh gốc chưa nén.

### 2.3. Mỗi sản phẩm chỉ được một ảnh

Sale cần gửi khách nhiều góc: mặt trước hộp, mặt sau, thành phần, ảnh pha, ảnh
quà tặng. Hiện chỉ có một trường `image_url` nên không làm được.

---

## 3. Đề nghị thay đổi

### 3.1. Thêm trường `images` — mảng, tối đa 20 ảnh mỗi sản phẩm

```json
{
  "code_product": "BK/TP-KV01-200",
  "name_product": "Kẹo Vừng Ta - 200g",
  "price": 100000,

  "images": [
    {
      "url": "https://cdn.traduoc.vn/products/BK-TP-KV01-200/01-mat-truoc.jpg",
      "width": 1200,
      "height": 1200,
      "alt": "Kẹo Vừng Ta hộp 200g - mặt trước",
      "sort_order": 1
    },
    {
      "url": "https://cdn.traduoc.vn/products/BK-TP-KV01-200/02-thanh-phan.jpg",
      "width": 1200,
      "height": 1200,
      "alt": "Bảng thành phần",
      "sort_order": 2
    }
  ],

  "image_url": "https://cdn.traduoc.vn/products/BK-TP-KV01-200/01-mat-truoc.jpg"
}
```

**Quy tắc:**

| Điều | Yêu cầu |
|---|---|
| Số lượng | Tối đa **20 ảnh** mỗi sản phẩm. Không có ảnh thì trả `"images": []` |
| Thứ tự | Theo `sort_order` tăng dần. **Ảnh đầu tiên là ảnh đại diện** |
| `url` | **Bắt buộc là đường dẫn HTTPS công khai**, không cần đăng nhập, không phải `data:` |
| **Đuôi tệp** | Đường dẫn **bắt buộc kết thúc bằng** `.jpg` `.jpeg` `.png` `.webp` — xem lại mục 2.1 |
| `width` / `height` | Nên có, để giao diện chừa chỗ trước khi ảnh tải xong |
| `alt` | Nên có, mô tả ngắn. Bỏ trống cũng được |

### 3.2. `image_url` giữ nguyên tên, đổi nội dung

Đừng bỏ trường `image_url` — nhiều hệ thống đang đọc nó. Chỉ cần đổi giá trị
thành **đường dẫn HTTPS của ảnh đầu tiên** thay vì chuỗi base64. Như vậy các bên
đang dùng vẫn chạy, không phải sửa gấp.

### 3.3. Ảnh phục vụ qua HTTP đúng chuẩn

Máy chủ ảnh cần trả đúng:

```
HTTP/1.1 200 OK
Content-Type: image/jpeg          ← không được là application/octet-stream
Content-Length: 184320
Cache-Control: public, max-age=31536000, immutable
```

Và:

- **Đường dẫn ổn định.** Ảnh đã publish thì đừng đổi đường dẫn; thay ảnh thì
  dùng tên tệp mới. Nhờ vậy phía dưới cache được lâu.
- **Không chặn theo Referer hay User-Agent.** Zalo và trình duyệt của nhân viên
  tải trực tiếp từ đường dẫn đó.
- **Hỗ trợ HTTPS**, chứng chỉ hợp lệ.

### 3.4. Khuyến nghị về tệp ảnh

| | Khuyến nghị |
|---|---|
| Định dạng | JPEG cho ảnh chụp, PNG khi cần nền trong |
| Cạnh dài | 1200–1600 px là đủ |
| Dung lượng | **Dưới 500 KB mỗi tấm**, tốt nhất 150–300 KB |
| Nén | JPEG quality ~80 |

Ảnh 2,7 MB hiện tại nên nén lại — nén xuống ~250 KB mắt thường không phân biệt
được, mà tải nhanh hơn mười lần.

---

## 4. Cách nghiệm thu

Chạy ba lệnh này, cả ba đạt là xong:

**1. Gói dữ liệu phải nhẹ hẳn** — 84 sản phẩm nên dưới 200 KB:

```bash
curl -s "https://apifm.traduoc.vn/api/products/external/list?limit=500" \
  -H "x-api-key: <khoá>" -o /tmp/fm.json && ls -lh /tmp/fm.json
```

**2. Không còn ảnh base64, và mọi đường dẫn đều có đuôi tệp:**

```bash
python3 - <<'EOF'
import json, re
rows = json.load(open('/tmp/fm.json'))['data']
base64_con_lai = sum(1 for r in rows for i in r.get('images', []) if str(i.get('url','')).startswith('data:'))
thieu_duoi = [i['url'] for r in rows for i in r.get('images', []) if not re.search(r'\.(jpg|jpeg|png|webp)$', str(i.get('url','')), re.I)]
qua_20 = [r['code_product'] for r in rows if len(r.get('images', [])) > 20]
print('anh base64 con lai :', base64_con_lai, '(phai = 0)')
print('url thieu duoi tep :', len(thieu_duoi), '(phai = 0)')
print('san pham > 20 anh  :', len(qua_20), '(phai = 0)')
print('so anh trung binh  :', round(sum(len(r.get("images", [])) for r in rows) / len(rows), 1))
EOF
```

**3. Ảnh tải được và đúng kiểu nội dung:**

```bash
curl -sI "<một url ảnh bất kỳ trong kết quả>" | grep -iE "^HTTP|content-type|content-length"
```

Phải ra `200` và `Content-Type: image/jpeg` (hoặc `image/png`, `image/webp`).

---

## 5. Về 26 sản phẩm chưa có ảnh

Trong 84 sản phẩm hiện có **26 sản phẩm không có ảnh nào**. Việc này không phải
lỗi kỹ thuật, nhưng ảnh hưởng trực tiếp tới bán hàng: sale không gửi được ảnh
thì khách khó chốt. Nhờ bên FM bổ sung ảnh cho nhóm này khi tiện.

Bên ChatMQL có thể gửi danh sách 26 mã sản phẩm đó nếu cần.

---

## 6. Trong lúc chờ

ChatMQL đã tự xử lý tạm: giải chuỗi base64 ra tệp ảnh thật rồi lưu trên máy chủ
của mình, nên hiện ảnh vẫn gửi được cho khách. Nhưng đó là bản vá:

- Mỗi sản phẩm vẫn chỉ có **một** ảnh, vì nguồn chỉ cho một.
- Ảnh bên FM cập nhật thì bên này phải chạy lại script mới thấy.
- Vẫn phải tải về 19 MB mỗi lần đồng bộ.

Nên vẫn rất mong bên FM sửa ở gốc theo mục 3.

Có gì chưa rõ hoặc cần trao đổi thêm về cấu trúc, bên ChatMQL sẵn sàng làm việc
trực tiếp.
