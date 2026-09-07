/**
 * backfill-doc-library.ts — Dựng cây tài liệu bán hàng từ danh mục sản phẩm.
 *
 * Vì sao là script chứ không phải thao tác tay: lần trước 78 sản phẩm được đổ
 * vào thư viện bằng cách sửa thẳng dữ liệu, nên công đó kẹt lại ở máy local và
 * không lặp lại được trên bản thật. Thành script thì chạy ở đâu cũng ra một kết
 * quả, và chạy lại nhiều lần vẫn an toàn.
 *
 * Cây thư mục hai tầng, theo đúng cách bảng biểu giá của công ty chia nhóm:
 *
 *     Trà cụ & phụ kiện trà        ← name_brand  (TRAKU)
 *       ├─ Ấm chén                 ← name_product_type
 *       ├─ Trà cụ
 *       └─ Phụ kiện
 *
 * NGUYÊN TẮC QUAN TRỌNG NHẤT: script chỉ ĐIỀN VÀO CHỖ TRỐNG, không bao giờ ghi
 * đè thứ người thật đã soạn. Mô tả bán hàng và bộ ảnh là công sức của đội sale;
 * một lần chạy lại mà xoá mất chúng thì không ai dám chạy script này nữa.
 *
 * Cách dùng:
 *   yarn tsx scripts/backfill-doc-library.ts             # xem trước, KHÔNG ghi
 *   yarn tsx scripts/backfill-doc-library.ts --apply     # ghi thật
 *   yarn tsx scripts/backfill-doc-library.ts --org=<id>  # chỉ định tổ chức
 */
import { prisma } from '../src/shared/prisma-client.js'
import { listCrmProducts, type CrmProduct } from '../src/modules/crm-products/crm-products-client.js'

const APPLY = process.argv.includes('--apply')
const ORG_ARG = process.argv.find((a) => a.startsWith('--org='))?.slice(6)

/**
 * Tên thương hiệu bên hệ thống nguồn là mã viết tắt (TRAF, TRAKU…). Đội sale
 * tìm tài liệu theo tên gọi thật, nên đổi sang chữ đọc được. Mã lạ không có
 * trong bảng này thì giữ nguyên — thà hiện mã còn hơn đoán sai tên.
 */
const TEN_THUONG_HIEU: Record<string, { ten: string; icon: string }> = {
  TRAF:  { ten: 'Trà',                    icon: '🍵' },
  TRAKU: { ten: 'Trà cụ & phụ kiện trà',  icon: '🫖' },
  TRABA: { ten: 'Bánh ăn cùng trà',       icon: '🍡' },
  TRADU: { ten: 'Trà dược',               icon: '🌿' },
}

const KHONG_PHAN_NHOM = 'Chưa phân nhóm'

type ThongKe = {
  thuMucTao: number
  docTao: number
  docCapNhat: number
  docGiuNguyen: number
  boQuaThieuMa: number
  dienMoTa: number
  dienAnh: number
  dienMiniApp: number
}

/**
 * Tìm thư mục theo tên trong cùng một cấp, chưa có thì tạo.
 *
 * `doc_folders` không có ràng buộc duy nhất trên tên, nên phải tự tìm trước —
 * nếu không, mỗi lần chạy lại sinh thêm một bộ thư mục trùng tên.
 */
async function timHoacTaoThuMuc(
  orgId: string,
  ten: string,
  parentId: string | null,
  icon: string | null,
  sortOrder: number,
  tk: ThongKe,
): Promise<string> {
  const co = await prisma.docFolder.findFirst({
    where: { orgId, parentId, name: ten },
    select: { id: true },
  })
  if (co) return co.id

  tk.thuMucTao++
  if (!APPLY) return `(moi:${parentId ?? 'goc'}/${ten})`

  const moi = await prisma.docFolder.create({
    data: { orgId, parentId, name: ten, icon, sortOrder, visibility: 'sales' },
    select: { id: true },
  })
  return moi.id
}

/** Mô tả từ hệ thống nguồn — bỏ thẻ HTML, gộp khoảng trắng thừa. */
function moTaGon(raw: Record<string, unknown>): string | null {
  const v = String(raw.description ?? '').trim()
  if (!v) return null
  const s = v.replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()
  return s || null
}

/** Nhóm sản phẩm theo thương hiệu rồi theo loại, giữ thứ tự nhiều-trước. */
function nhomTheoCay(products: CrmProduct[]): Map<string, Map<string, CrmProduct[]>> {
  const cay = new Map<string, Map<string, CrmProduct[]>>()
  for (const p of products) {
    const th = (p.brand ?? '').trim() || KHONG_PHAN_NHOM
    const loai = (p.categoryName ?? '').trim() || KHONG_PHAN_NHOM
    if (!cay.has(th)) cay.set(th, new Map())
    const con = cay.get(th)!
    if (!con.has(loai)) con.set(loai, [])
    con.get(loai)!.push(p)
  }
  return cay
}

function xepTheoSoLuong<T>(m: Map<string, T[]>): [string, T[]][]
function xepTheoSoLuong(m: Map<string, Map<string, CrmProduct[]>>): [string, Map<string, CrmProduct[]>][]
function xepTheoSoLuong(m: Map<string, unknown>): [string, unknown][] {
  const dem = (v: unknown): number =>
    Array.isArray(v) ? v.length : [...(v as Map<string, CrmProduct[]>).values()].reduce((s, x) => s + x.length, 0)
  return [...m.entries()].sort((a, b) => dem(b[1]) - dem(a[1]))
}

async function main() {
  const org = ORG_ARG
    ? await prisma.organization.findUnique({ where: { id: ORG_ARG }, select: { id: true, name: true } })
    : await prisma.organization.findFirst({ select: { id: true, name: true }, orderBy: { createdAt: 'asc' } })
  if (!org) throw new Error('Không tìm thấy tổ chức nào. Truyền --org=<id>.')

  console.log(`\nTổ chức: ${org.name} (${org.id})`)
  console.log(APPLY ? 'Chế độ: GHI THẬT\n' : 'Chế độ: xem trước — không ghi gì. Thêm --apply để ghi.\n')

  const kq = await listCrmProducts({ orgId: org.id, pageSize: 200 })
  console.log(`Nguồn sản phẩm: ${kq.source} · lấy về ${kq.products.length}/${kq.meta.total} sản phẩm`)

  if (kq.products.length < kq.meta.total) {
    throw new Error(
      `Mới lấy được ${kq.products.length}/${kq.meta.total}. Dừng lại để khỏi dựng cây thiếu sản phẩm.`,
    )
  }

  const tk: ThongKe = {
    thuMucTao: 0, docTao: 0, docCapNhat: 0, docGiuNguyen: 0,
    boQuaThieuMa: 0, dienMoTa: 0, dienAnh: 0, dienMiniApp: 0,
  }

  const cay = nhomTheoCay(kq.products)
  let thuTuTH = 0

  for (const [maTH, theoLoai] of xepTheoSoLuong(cay)) {
    const nhan = TEN_THUONG_HIEU[maTH]
    const tenTH = nhan?.ten ?? maTH
    const idTH = await timHoacTaoThuMuc(org.id, tenTH, null, nhan?.icon ?? '📦', thuTuTH++, tk)
    const tong = [...theoLoai.values()].reduce((s, x) => s + x.length, 0)
    console.log(`\n📁 ${tenTH}${nhan ? ` (${maTH})` : ''} — ${tong} sản phẩm`)

    let thuTuLoai = 0
    for (const [tenLoai, dsSp] of xepTheoSoLuong(theoLoai)) {
      const idLoai = await timHoacTaoThuMuc(org.id, tenLoai, idTH, null, thuTuLoai++, tk)
      console.log(`   └─ ${tenLoai} (${dsSp.length})`)

      for (const p of dsSp) {
        const ma = (p.code ?? '').trim()
        if (!ma) { tk.boQuaThieuMa++; continue }

        const dangCo = await prisma.productDoc.findUnique({
          where: { orgId_productCode: { orgId: org.id, productCode: ma } },
          select: { id: true, folderId: true, description: true, images: true, miniAppId: true },
        })

        // Chỉ điền chỗ trống. Người thật đã soạn gì thì giữ nguyên.
        const moTa = moTaGon(p.raw)
        const anh = p.imageUrl ? [p.imageUrl] : []
        const miniApp = `${ma}-ZL`

        const them: Record<string, unknown> = {}
        if (!dangCo?.folderId) them.folderId = idLoai
        if (!dangCo?.description && moTa) { them.description = moTa; tk.dienMoTa++ }
        if (!dangCo?.images?.length && anh.length) { them.images = anh; tk.dienAnh++ }
        if (!dangCo?.miniAppId) { them.miniAppId = miniApp; tk.dienMiniApp++ }

        if (!dangCo) {
          tk.docTao++
          if (APPLY) {
            await prisma.productDoc.create({
              data: { orgId: org.id, productCode: ma, name: p.name, folderId: idLoai, ...them },
            })
          }
        } else if (Object.keys(them).length) {
          tk.docCapNhat++
          // Tên luôn đồng bộ lại: nó là bản sao để hiện khi nguồn lỗi, không
          // phải nội dung ai soạn, nên lệch tên là hại chứ không lợi.
          if (APPLY) {
            await prisma.productDoc.update({
              where: { id: dangCo.id },
              data: { name: p.name, ...them },
            })
          }
        } else {
          tk.docGiuNguyen++
        }
      }
    }
  }

  console.log('\n' + '─'.repeat(52))
  console.log(`Thư mục tạo mới        : ${tk.thuMucTao}`)
  console.log(`Tài liệu tạo mới       : ${tk.docTao}`)
  console.log(`Tài liệu bổ sung       : ${tk.docCapNhat}`)
  console.log(`Tài liệu giữ nguyên    : ${tk.docGiuNguyen}`)
  console.log(`  ├─ điền mô tả        : ${tk.dienMoTa}`)
  console.log(`  ├─ điền ảnh          : ${tk.dienAnh}`)
  console.log(`  └─ điền mã Mini App  : ${tk.dienMiniApp}`)
  if (tk.boQuaThieuMa) console.log(`Bỏ qua (không có mã)   : ${tk.boQuaThieuMa}`)
  console.log('─'.repeat(52))
  console.log(APPLY ? '\nĐã ghi xong.\n' : '\nChưa ghi gì. Chạy lại với --apply để ghi thật.\n')
}

main()
  .catch((e) => { console.error('\nLỖI:', e instanceof Error ? e.message : e); process.exitCode = 1 })
  .finally(() => prisma.$disconnect())
