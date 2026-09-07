BEGIN;

-- Nhập lại từ đầu: xoá bản clone lần trước (chỉ những cái mang dấu nguồn).
DELETE FROM doc_assets WHERE kind = 'product' AND source_id LIKE 'product:%';

-- Thư mục cha cho toàn bộ danh mục sản phẩm, đứng ngay sau Bảng giá để người
-- xem đi từ tổng quan xuống chi tiết.
INSERT INTO doc_folders (id, org_id, name, description, icon, visibility, sort_order, created_at, updated_at)
SELECT gen_random_uuid()::text, o.id, 'Danh mục sản phẩm',
       'Toàn bộ sản phẩm chép từ danh mục sản phẩm của hệ thống.', '📦', 'sales', 1, now(), now()
FROM organizations o
WHERE NOT EXISTS (
  SELECT 1 FROM doc_folders f WHERE f.org_id = o.id AND f.name = 'Danh mục sản phẩm' AND f.parent_id IS NULL
);

-- Mỗi danh mục CÓ HÀNG thành một thư mục con. Danh mục rỗng bỏ qua để cây
-- không có ngăn trống.
INSERT INTO doc_folders (id, org_id, parent_id, name, icon, visibility, sort_order, created_at, updated_at)
SELECT
  gen_random_uuid()::text, pc.org_id,
  (SELECT f.id FROM doc_folders f
    WHERE f.org_id = pc.org_id AND f.name = 'Danh mục sản phẩm' AND f.parent_id IS NULL LIMIT 1),
  pc.name, '📁', 'sales', pc.sort_order, now(), now()
FROM product_categories pc
WHERE EXISTS (SELECT 1 FROM products p WHERE p.category_id = pc.id)
  AND NOT EXISTS (
    SELECT 1 FROM doc_folders f
    WHERE f.org_id = pc.org_id AND f.name = pc.name
      AND f.parent_id = (SELECT f2.id FROM doc_folders f2
                          WHERE f2.org_id = pc.org_id AND f2.name = 'Danh mục sản phẩm'
                            AND f2.parent_id IS NULL LIMIT 1)
  );

-- Chép TOÀN BỘ sản phẩm thành tài liệu. Tài liệu tự chứa nội dung nên không
-- phụ thuộc hệ thống nguồn; hàng ngừng bán vào diện nội bộ để sale không lỡ
-- tay gửi khách, vẫn tra cứu được ở module quản lý.
INSERT INTO doc_assets (
  id, org_id, folder_id, kind, title, description, text_content,
  images, video_urls, product_codes, tags, visibility, source_id,
  created_at, updated_at
)
SELECT
  gen_random_uuid()::text,
  p.org_id,
  (SELECT f.id FROM doc_folders f
    WHERE f.org_id = p.org_id AND f.name = pc.name
      AND f.parent_id = (SELECT f2.id FROM doc_folders f2
                          WHERE f2.org_id = p.org_id AND f2.name = 'Danh mục sản phẩm'
                            AND f2.parent_id IS NULL LIMIT 1)
    LIMIT 1),
  'product',
  p.name,
  p.description,
  -- Có mã thì để hệ thống tra giá lúc gửi cho khỏi lỗi thời; không mã thì
  -- chép giá vào tài liệu, nếu không tài liệu sẽ gửi đi mà thiếu giá.
  CASE WHEN p.code IS NULL AND p.price IS NOT NULL
    THEN 'Giá niêm yết: ' || to_char(p.price, 'FM999G999G999') || 'đ'
         || CASE WHEN p.price_max IS NOT NULL
                 THEN ' – ' || to_char(p.price_max, 'FM999G999G999') || 'đ' ELSE '' END
  END,
  p.images,
  p.video_urls,
  CASE WHEN p.code IS NULL THEN ARRAY[]::text[] ELSE ARRAY[upper(p.code)] END,
  p.tags,
  CASE WHEN p.status = 'active' THEN 'sales' ELSE 'internal' END,
  'product:' || p.id,
  now(), now()
FROM products p
JOIN product_categories pc ON pc.id = p.category_id;

-- Dọn các thư mục mẫu đã rỗng sau khi tài liệu giả bị thay.
DELETE FROM doc_folders f
WHERE f.name IN ('Trà','Trà xanh','Trà dược','Bánh','Bánh trung thu','Madam Hương','Maison','Bánh kẹo','Trà cụ & Ấm chén')
  AND NOT EXISTS (SELECT 1 FROM doc_assets a WHERE a.folder_id = f.id)
  AND NOT EXISTS (SELECT 1 FROM doc_folders c WHERE c.parent_id = f.id);

COMMIT;
