# Kế hoạch: Thư viện tài liệu bán hàng + nhập dữ liệu từ Google Drive

Trạng thái: **CHỜ DUYỆT — chưa tải file nào về.**
Khảo sát ngày 2026-09-05 trên thư mục Drive `1RZ84s9qXNKakefLxxqE6ZhFQZDWEWxmi`.

## 1. Kết quả khảo sát Drive

### 1.1 Bốn nhánh cấp 1

| Thư mục | Nội dung | Dùng cho |
|---|---|---|
| `01_SALE-KIT_2026` | `0_BIEU-GIA_2026` (2 ảnh biểu giá) và `02_UY-TIN-THUONG-HIEU_2026` (xưởng sản xuất, vùng nguyên liệu) | **Bảng biểu giá** + tư liệu uy tín |
| `02_NGUYEN-LIEU-TRUYEN-THONG-2026` | 6 nhánh: `3. SẢN PHẨM`, `1. VÙNG NGUYÊN LIỆU`, `2. XƯỞNG SẢN XUẤT`, `4. ĐỘI NGŨ NHÂN SỰ`, `6. CÔNG TÁC THỰC TẾ`, `8. MEDIA SÀN TMĐT` | **Ảnh/video theo sản phẩm** + tư liệu thương hiệu |
| `03_MEDIA-NOI-BO` | Đào tạo, khen thưởng, thiết kế nội bộ, video recap | Nội bộ — **không gửi khách** |
| `3. BANNER TẾT` | Banner ưu đãi mùa vụ (ưu đãi chung, tặng sếp, biếu gia đình…) | Tư liệu chiến dịch theo mùa |

### 1.2 Nhánh sản phẩm — chi tiết nhất

```
02_NGUYEN-LIEU-TRUYEN-THONG-2026
└── 3. SẢN PHẨM
    ├── 1. ẢNH SẢN PHẨM
    │   ├── 1. TÁCH NỀN          ← ảnh nền trắng, hợp gửi khách
    │   │   ├── 100GR            ← nhóm theo QUY CÁCH
    │   │   │   ├── VẠN LỘC TRÀ  ← thư mục = TÊN SẢN PHẨM
    │   │   │   ├── VẠN THỊNH TRÀ
    │   │   │   ├── VẠN PHÚC TRÀ
    │   │   │   ├── VẠN HỶ TRÀ   → Hỷ2.png, Hỷ5.png, Hỷ6.png
    │   │   │   ├── VẠN THỌ TRÀ
    │   │   │   └── VẠN KHANG TRÀ
    │   │   ├── 500GR            ← tên rút gọn: THỊNH, THỌ, KHANG, HỶ, LỘC, PHÚC
    │   │   ├── HỘP THIẾC · HỘP MICA · DECOR · ĐỒ ĂN · TRÀ 2024
    │   │   └── MỚI → 1. TRAKU (1. CỐC Ủ NHIỆT) · 2. TRAF
    │   └── 2. CONCEPT           ← ảnh concept, không phải ảnh bán hàng
    └── 2. VIDEO SẢN PHẨM        ← nhóm theo HÀNH ĐỘNG: Pha nước, Rót nước,
                                    Đun nước, Thưởng trà, Cánh, Tri ân 2024
```

### 1.3 Ba điểm quyết định cách nhập

1. **Tên file KHÔNG phải mã sản phẩm.** Thực tế là `Hỷ2.png`, `phúc.png`, `THỊNH KRAF.png`, `4.png`. Vậy **phải khớp theo TÊN THƯ MỤC**, không khớp theo tên file.
2. **Cùng một sản phẩm có hai cách gọi** tuỳ quy cách: `VẠN HỶ TRÀ` (100GR) và `HỶ` (500GR). Cần bảng đối chiếu tên thư mục → mã sản phẩm, làm một lần rồi tái dùng.
3. **File rất nặng**: ảnh 2–9 MB/tấm, có video 225 MB. Không thể tải trọn bộ vào máy chủ mà không nén và không lọc.

### 1.4 Định dạng tìm thấy

Chỉ có **ảnh (png/jpg)** và **video (mp4)**. Chưa gặp PDF, Google Docs hay Sheets ở các nhánh đã khảo sát. Biểu giá hiện đang là **ảnh** (`20260207_ANH_BIEU-GIA.png`), không phải bảng số liệu — nên biểu giá số vẫn phải lấy từ hệ thống sản phẩm, ảnh này chỉ là tư liệu gửi khách.

## 2. Thiết kế cần bổ sung cho module Tài liệu bán hàng

Hiện tại tài liệu chỉ gắn theo mã sản phẩm (`product_docs`). Yêu cầu mới là **thư viện tài liệu động do admin tự tạo**, nên cần thêm hai bảng:

### 2.1 `doc_folders` — thư mục do admin tạo
```
id, orgId, parentId (cây), name, description, sortOrder, visibility
```
`visibility`: `sales` (nhân viên gửi khách được) | `internal` (chỉ nội bộ) | `ai_only`.
Cần thiết vì nhánh `03_MEDIA-NOI-BO` tuyệt đối không được gửi khách.

### 2.2 `doc_assets` — một tài nguyên bất kỳ
```
id, orgId, folderId, kind (image|video|pdf|doc|text|link),
title, description, textContent (cho kind=text),
fileUrl, thumbUrl, fileSize, mimeType,
sourceUrl (link Drive gốc), sourceId (fileId Drive — chống nhập trùng),
tags[], visibility, createdById, createdAt, updatedAt
```

### 2.3 `doc_asset_products` — nối tài nguyên ↔ sản phẩm (n-n)
```
assetId, productCode
```
Một ảnh dùng cho nhiều mã (ví dụ ảnh combo), một mã có nhiều ảnh.
`product_docs` hiện tại vẫn giữ nguyên vai trò "mô tả + ảnh đại diện + video chính"
của từng mã; thư viện là kho tài nguyên rộng hơn đứng sau.

### 2.4 AI đọc gì

- `kind = text | doc | pdf` → trích văn bản, đưa vào ngữ cảnh khi tư vấn.
- `kind = image | video` → AI **không đọc nội dung**, chỉ biết "có N ảnh/video cho mã X" để đề nghị gửi. Nhân viên hoặc luồng gửi ảnh tự động sẽ gửi.
- Chỉ tài nguyên `visibility = sales` mới được phép gửi ra khách — chặn trong code, không chỉ nhắc trong prompt.

## 3. Kế hoạch nhập dữ liệu

### Giai đoạn 0 — Chốt bảng đối chiếu tên (cần anh xác nhận)
Xuất danh sách **tất cả thư mục cấp sản phẩm** trong Drive kèm số file, đặt cạnh danh sách mã sản phẩm thật từ hệ thống nguồn. Anh (hoặc tôi đề xuất trước, anh duyệt) điền mã cho từng thư mục:

| Thư mục Drive | Quy cách | Mã sản phẩm | Ghi chú |
|---|---|---|---|
| `VẠN HỶ TRÀ` | 100GR | ? | |
| `HỶ` | 500GR | ? | cùng dòng, khác quy cách |
| … | | | |

Không có bước này thì nhập vào sẽ gắn sai mã, sau gỡ ra rất mất công.

### Giai đoạn 1 — Nhập tài nguyên gắn được với sản phẩm
Chỉ lấy `1. ẢNH SẢN PHẨM / 1. TÁCH NỀN` (ảnh nền trắng, hợp gửi khách nhất) và `2. VIDEO SẢN PHẨM`.
- Ảnh: nén về khoảng 1600px, chất lượng 82, sinh kèm thumbnail. Ước tính giảm 8–10 lần dung lượng.
- Video: **không tải file**, chỉ lưu link Drive (`sourceUrl`). Tránh phình ổ đĩa và tránh phải phục vụ file 225 MB.
- Bỏ qua `2. CONCEPT` — ảnh concept không dùng để tư vấn.

### Giai đoạn 2 — Nhập tư liệu thương hiệu
`0_BIEU-GIA_2026`, `02_UY-TIN-THUONG-HIEU_2026`, `1. VÙNG NGUYÊN LIỆU`, `2. XƯỞNG SẢN XUẤT` → thư mục thư viện riêng, `visibility = sales`, không gắn mã sản phẩm.

### Giai đoạn 3 — Chiến dịch mùa vụ
`3. BANNER TẾT` → thư mục "Chiến dịch/Tết", có hạn dùng theo mùa.

### Không nhập
`03_MEDIA-NOI-BO` (đào tạo, khen thưởng, recap nội bộ). Nếu cần thì để `visibility = internal`, tuyệt đối không cho gửi khách.

### Cách chạy nhập
Script một chiều `scripts/import-drive-docs.ts`:
1. Duyệt cây Drive theo `parentId`, dựng lại cấu trúc thư mục vào `doc_folders`.
2. Với mỗi file: tải → nén (ảnh) → lưu vào `uploads/doc-assets/` → tạo `doc_assets` với `sourceId` là fileId Drive.
3. `sourceId` là khoá chống trùng: chạy lại script chỉ cập nhật, không nhân bản.
4. Gắn `productCode` theo bảng đối chiếu ở Giai đoạn 0.
5. In báo cáo: nhập bao nhiêu, bỏ qua bao nhiêu, thư mục nào chưa map được mã.

## 4. Cần anh quyết trước khi tôi làm

1. **Bảng đối chiếu tên thư mục → mã sản phẩm** (Giai đoạn 0). Tôi xuất danh sách, anh duyệt.
2. **Video**: chỉ lưu link Drive (đề xuất) hay tải hẳn file về máy chủ?
3. **Ảnh concept và ảnh 2024 cũ**: nhập hay bỏ?
4. **Quyền xem**: nhánh nào nhân viên được phép gửi thẳng cho khách, nhánh nào chỉ tra cứu nội bộ?
5. **Dung lượng ổ đĩa** máy chủ còn bao nhiêu — quyết định mức nén và có tải video hay không.

Sau khi anh chốt 5 điểm trên, tôi làm bảng dữ liệu (mục 2) rồi chạy nhập theo từng giai đoạn, mỗi giai đoạn kiểm tra xong mới sang bước kế.
