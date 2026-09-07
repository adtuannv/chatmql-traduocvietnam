# Cấu trúc dữ liệu sản phẩm & nguồn dữ liệu chuẩn

Tài liệu chốt cách ChatMQL lấy và hiển thị dữ liệu sản phẩm, để khi TDVN cấp API
chính thức thì chỉ phải sửa đúng một chỗ.

## 1. Nguyên tắc: hai loại dữ liệu, hai chủ sở hữu

| Loại | Chủ sở hữu | Nội dung | Sửa ở đâu |
|---|---|---|---|
| **Dữ liệu gốc sản phẩm** | Hệ thống nguồn (CRM/TDVN) | mã, tên, giá, tồn kho, ĐVT, kho, danh mục, VAT | Chỉ sửa ở hệ thống nguồn. ChatMQL **chỉ đọc**. |
| **Tri thức bán hàng** | ChatMQL | ảnh, mô tả, video, tài liệu tư vấn | Module **Tài liệu bán hàng** (`/sales-docs`) |

Lý do tách: giá và tồn kho đổi liên tục, giữ bản sao ở ChatMQL là chắc chắn lệch.
Còn ảnh/mô tả/video là tài nguyên bán hàng riêng, hệ thống nguồn không có, nên
ChatMQL sở hữu.

**Khoá liên kết giữa hai bên là MÃ SẢN PHẨM (`code`).** Đổi hệ thống nguồn vẫn
giữ nguyên tri thức đã soạn, miễn là mã không đổi.

## 2. Cấu trúc dữ liệu sản phẩm chuẩn

Định nghĩa tại `bizcrm_backend_source/src/modules/crm-products/crm-products-client.ts`
(`interface CrmProduct`). Toàn bộ giao diện và AI chỉ dựa vào hình dạng này.

| Trường | Kiểu | Bắt buộc | Ý nghĩa |
|---|---|---|---|
| `code` | `string \| null` | **Có** | Mã sản phẩm (SKU). Khoá nghiệp vụ để gắn tài liệu và lên đơn. |
| `name` | `string` | **Có** | Tên hiển thị. |
| `id` | `string \| number \| null` | Không | Id bên hệ thống nguồn, chỉ để đối chiếu. |
| `price` | `number \| null` | Nên có | Giá bán. `null` = "Liên hệ". |
| `priceMax` | `number \| null` | Không | Cận trên khi bán theo khoảng giá. |
| `currency` | `string` | Không | Mặc định `VND`. |
| `unit` | `string \| null` | Nên có | Đơn vị tính (Gói, Hộp, Cái…). |
| `vatNote` | `string \| null` | Không | Ghi chú thuế, ví dụ "Đã có VAT 8%". |
| `inventory` | `number \| null` | Nên có | Tồn kho. `0` hiện nhãn "Hết hàng". |
| `weight` | `number \| null` | Nên có | Khối lượng (gram) — dùng tính phí ship. |
| `warehouseId` / `warehouseName` | `number \| string \| null` | Nên có | Kho chứa. |
| `categoryId` / `categoryName` | `string \| number \| null` | Nên có | Danh mục, dùng dựng bộ lọc. |
| `brand` | `string \| null` | Không | Thương hiệu. |
| `status` | `string \| null` | Không | `active` / `inactive`… Sản phẩm `inactive` hiện mờ. |
| `raw` | `object` | **Có** | Bản ghi gốc nguyên vẹn. Nhờ nó, hệ thống nguồn trả thêm trường nào cũng không mất dữ liệu. |

### Ánh xạ tên trường

Hệ thống nguồn đặt tên không thống nhất, nên `normalizeProduct` dò theo danh sách
khoá ứng viên thay vì cứng một tên:

| Trường chuẩn | Các tên chấp nhận |
|---|---|
| `code` | `code`, `code_product`, `sku`, `ma_sp`, `product_code` |
| `name` | `name`, `product_name`, `ten_sp`, `title` |
| `price` | `price`, `gia_ban`, `sale_price`, `unit_price`, `price_sale` |
| `inventory` | `inventory`, `ton_kho`, `stock`, `quantity`, `so_luong` |
| `unit` | `unit`, `don_vi`, `unit_name`, `dvt` |
| `categoryName` | `category_name`, `category`, `danh_muc`, `nhom_sp`, `ten_nhom` |

Khi có API chính thức, chỉ cần bổ sung tên trường thật vào các danh sách trên.

## 3. Nguồn dữ liệu — chuyển đổi bằng cấu hình

Biến môi trường `CRM_PRODUCT_SOURCE`:

| Giá trị | Đường lấy | Xác thực | Ghi chú |
|---|---|---|---|
| `bridge` (mặc định) | `/api/external/chatmql/products/catalog` | Service key `X-ChatMQL-API-Key` | **Không hết hạn.** Đang dùng cho form lên đơn. |
| `dashboard` | `/api/dashboard/search-products` của `apicrm.traduoc.vn` | `Bearer` JWT của một tài khoản CRM | Token hết hạn theo phiên — chỉ hợp để thử. |

Khoá và token **chỉ nằm ở backend**, không bao giờ ra trình duyệt.

### Thêm nguồn chính thức của TDVN sau này

Chỉ cần 3 bước, không đụng tới giao diện:

1. Viết một hàm `searchViaTdvn(...)` trong `crm-products-client.ts`, trả về mảng
   đã chạy qua `normalizeProduct`.
2. Thêm `'tdvn'` vào `CrmProductSource` và nhánh tương ứng trong `resolveSource()`
   / `listCrmProducts()`.
3. Bổ sung tên trường thật vào bảng ánh xạ ở mục 2 nếu khác.

Nếu API mới có phân trang thật (`page`, `total`), thay phần thân `listCrmProducts`
để chuyển tham số xuống thẳng API thay vì cắt trang tại backend — hình dạng trả
về giữ nguyên nên frontend không phải sửa.

## 4. API của ChatMQL

| Method | Đường dẫn | Trả về |
|---|---|---|
| `GET` | `/api/v1/crm-products` | Danh sách để duyệt. Tham số: `q`, `warehouseId`, `category`, `inStock`, `page`, `pageSize`. Trả `{ source, products[], categories[], meta }`. |
| `GET` | `/api/v1/crm-products/search` | Tìm nhanh theo từ khoá, dùng cho ô gợi ý. |
| `GET` | `/api/v1/crm-products/source` | Nguồn đang bật + đã cấu hình chưa. |

## 5. Hiển thị

Trang `/crm-products` (menu **Sản phẩm (CRM)**):

- Danh sách duyệt được ngay, không bắt gõ từ khoá.
- Lọc theo: từ khoá, kho, danh mục, còn hàng.
- Hai kiểu xem: bảng (đầy đủ cột) và thẻ (nhìn nhanh).
- Phân trang 50 sản phẩm mỗi trang.
- Mỗi dòng có lối tắt sang **Tài liệu bán hàng** của sản phẩm đó theo mã.
- Không có nút thêm/sửa/xoá — đúng nguyên tắc chỉ đọc.

## 6. Việc còn lại

- [ ] Nhận API chính thức của TDVN và bổ sung nguồn `tdvn` (mục 3).
- [ ] Gắn tài liệu bán hàng theo **mã sản phẩm** thay vì id bảng `products` nội bộ,
      để tri thức không phụ thuộc bảng cũ.
- [ ] Cho AI đọc tri thức từ tài liệu bán hàng khi tư vấn (hiện AI chỉ tra bảng
      `products` nội bộ, cần vector embedding nên phải có dữ liệu tại chỗ).
- [ ] Quyết định số phận bảng `products` nội bộ sau khi nguồn chính thức chạy:
      giữ làm nơi lưu tri thức, hay chuyển hẳn sang bảng tài liệu riêng.
