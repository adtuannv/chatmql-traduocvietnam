/**
 * tools-runtime.ts — Function-call tool registry for the responder agent loop.
 *
 * Each tool = OpenAI function schema (the model sees) + an executor that runs the
 * retrieval and ENFORCES that tool's guardrail (allowed categories) in code.
 * Disabled tools are never exposed. Used by reply-generator's agentic loop.
 */
import { retrieveProductSemantic } from '../../products/product-embedding.js'
import { formatProductPrice } from '../../products/product-price.js'
import { retrieveKb } from '../../knowledge/kb-service.js'
import { retrieveKbSemantic } from '../../knowledge/embedding-service.js'
import { aggregate } from '../../products/product-query-service.js'
import { TOOL_NAMES, type ToolName, type ToolsConfig } from '../tools-config-service.js'
import type { OpenaiToolDef } from '../providers/openai.js'
import { retrieveProductDocs } from '../../product-docs/product-docs-service.js'
import { retrieveDocAssets } from '../../doc-library/doc-library-service.js'
import { prisma } from '../../../shared/prisma-client.js'
import { isImageAvailable } from '../../chat/send-image-core.js'

const QUERY_PARAM = {
  type: 'object',
  properties: { query: { type: 'string', description: 'Truy vấn tìm kiếm bằng tiếng Việt theo nhu cầu của khách' } },
  required: ['query'],
} as const

const TOOL_SCHEMAS: Record<ToolName, { description: string }> = {
  search_products: { description: 'Tra cứu SẢN PHẨM trong catalog (tên, mô tả, giá) để tư vấn/báo giá. Dùng khi khách hỏi về một sản phẩm cụ thể hoặc giá sản phẩm.' },
  search_knowledge: { description: 'Tra cứu KIẾN THỨC: câu hỏi thường gặp (FAQ/hỏi-đáp ngắn) LẪN bài viết dài (chính sách, hướng dẫn, thông tin/giới thiệu, bảng giá dịch vụ). Dùng cho MỌI câu hỏi thông tin/kiến thức (không phải giá một sản phẩm cụ thể).' },
}

// Action tool — always available; lets the AI escalate to a human itself.
export const HANDOFF_TOOL = 'request_handoff'
const HANDOFF_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: HANDOFF_TOOL,
    description: 'Chuyển hội thoại cho NHÂN VIÊN khi: khách yêu cầu gặp người, khiếu nại nặng, ngoài phạm vi, thông tin nhạy cảm (pháp lý/y tế/tài chính), hoặc không thể trả lời chính xác sau khi đã tra cứu.',
    parameters: {
      type: 'object',
      properties: { reason: { type: 'string', description: 'Lý do ngắn gọn cần chuyển nhân viên' } },
      required: ['reason'],
    },
  },
}

// Action tool — records a pending appointment request for staff to confirm
// (NEVER books directly). The customer is told it's being processed.
export const APPOINTMENT_TOOL = 'request_appointment'
const APPOINTMENT_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: APPOINTMENT_TOOL,
    description: 'Ghi nhận yêu cầu ĐẶT LỊCH/HẸN của khách (KHÔNG đặt trực tiếp — nhân viên sẽ xác nhận). Dùng khi khách muốn đặt lịch hẹn/tư vấn/khám và đã nêu thời gian mong muốn.',
    parameters: {
      type: 'object',
      properties: {
        desired_time: { type: 'string', description: 'Thời gian khách mong muốn (nguyên văn, vd "3h chiều mai", "20/6 9 giờ sáng")' },
        customer_name: { type: 'string', description: 'Tên khách (nếu có)' },
        phone: { type: 'string', description: 'Số điện thoại (nếu khách cung cấp)' },
        note: { type: 'string', description: 'Nội dung/loại lịch hẹn (nếu có)' },
      },
      required: ['desired_time'],
    },
  },
}

// Action tool — logs a KNOWLEDGE GAP for staff to fill (fire-and-forget; does NOT
// interrupt the reply, unlike request_handoff). Use when retrieval is empty/
// insufficient to answer an info question. Executed in reply-generator's loop.
export const LOG_GAP_TOOL = 'log_knowledge_gap'
const LOG_GAP_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: LOG_GAP_TOOL,
    description: 'Ghi nhận LỖ HỔNG KIẾN THỨC khi bạn KHÔNG đủ dữ liệu để trả lời một câu hỏi thông tin (đã tra cứu mà rỗng/không khớp). Ghi nhận để nhân viên bổ sung kiến thức — KHÔNG gián đoạn, bạn vẫn tiếp tục trả lời lịch sự ("em kiểm tra lại rồi báo anh/chị"). KHÔNG dùng cho việc khẩn cần gặp người ngay (dùng request_handoff).',
    parameters: {
      type: 'object',
      properties: {
        question: { type: 'string', description: 'Câu hỏi của khách / thông tin còn thiếu (nguyên văn, ngắn gọn)' },
        gap_type: { type: 'string', enum: ['missing_info', 'needs_knowledge', 'needs_staff'], description: 'missing_info = thiếu dữ liệu cụ thể (giá/chính sách/thông tin SP); needs_knowledge = thiếu kiến thức nghiệp vụ nền; needs_staff = cần chuyên môn nhân viên (không khẩn)' },
        suggested_answer: { type: 'string', description: 'Gợi ý hướng trả lời nếu có (tuỳ chọn) — giúp nhân viên xử lý nhanh' },
      },
      required: ['question', 'gap_type'],
    },
  },
}

// Overview tool — always available alongside the search tools. Answers "câu tổng
// quan" (what does the shop sell / what categories exist) which nearest-neighbor
// search cannot: it returns category counts, not a handful of nearest items.
export const CATALOG_OVERVIEW_TOOL = 'catalog_overview'
const CATALOG_OVERVIEW_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: CATALOG_OVERVIEW_TOOL,
    description: 'Xem TỔNG QUAN danh mục: shop có những NHÓM sản phẩm/kiến thức nào và bao nhiêu mục mỗi nhóm. Dùng cho câu hỏi chung như "shop bán những gì", "có những loại/dịch vụ nào", trước khi đi sâu bằng search_products.',
    parameters: { type: 'object', properties: {} },
  },
}

/** Build OpenAI tool defs: enabled search tools + overview + always-on action tools. */
// Action tool — gửi ẢNH SẢN PHẨM cho khách.
//
// Mô hình chỉ được nói GỬI ẢNH CỦA SẢN PHẨM NÀO, không được tự đưa URL. Máy chủ
// tra sản phẩm trong catalog (chỉ sản phẩm status='active'), lấy ảnh đã duyệt
// rồi mới gửi — đúng cùng một chốt chặn như thư viện tài liệu của nhân viên.
export const SEND_IMAGE_TOOL = 'send_product_image'
const SEND_IMAGE_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: SEND_IMAGE_TOOL,
    description:
      'Gửi ẢNH THẬT của một sản phẩm cho khách qua Zalo. Dùng khi khách hỏi xem ảnh, ' +
      'hỏi mẫu mã/bao bì/hình dáng sản phẩm, hoặc khi ảnh giúp khách quyết định mua. ' +
      'Chỉ gọi khi đã xác định được sản phẩm cụ thể. Không bịa tên sản phẩm.',
    parameters: {
      type: 'object',
      properties: {
        product: { type: 'string', description: 'Tên hoặc mã sản phẩm cần gửi ảnh (đúng như trong catalog)' },
        caption: { type: 'string', description: 'Lời nhắn ngắn gửi kèm ảnh (tuỳ chọn)' },
      },
      required: ['product'],
    },
  },
}

// Action tool — records a draft order / pending purchase for customer confirmation and staff fulfillment.
export const ORDER_TOOL = 'create_order'
const ORDER_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: ORDER_TOOL,
    description:
      'Lên ĐƠN HÀNG NHÁP / Ghi nhận đơn mua hàng khi khách đồng ý chốt đơn hoặc đã cung cấp thông tin nhận hàng (Tên, SĐT, Địa chỉ, Sản phẩm). ' +
      'Lưu thông tin đơn hàng vào hệ thống để nhân viên xác nhận và gửi hàng.',
    parameters: {
      type: 'object',
      properties: {
        customer_name: { type: 'string', description: 'Họ tên người nhận hàng' },
        phone: { type: 'string', description: 'Số điện thoại nhận hàng' },
        address: { type: 'string', description: 'Địa chỉ nhận hàng cụ thể (số nhà, đường, phường/xã, quận/huyện, tỉnh/thành phố)' },
        items: {
          type: 'array',
          description: 'Danh sách các sản phẩm khách đặt mua',
          items: {
            type: 'object',
            properties: {
              product_name: { type: 'string', description: 'Tên sản phẩm đúng theo catalog' },
              quantity: { type: 'number', description: 'Số lượng đặt mua' },
              price: { type: 'number', description: 'Đơn giá 1 sản phẩm (VND, đã gồm VAT)' },
              unit: { type: 'string', description: 'Quy cách / đơn vị tính (vd: túi 100g, hộp, set...)' },
            },
            required: ['product_name', 'quantity', 'price'],
          },
        },
        shipping_fee: { type: 'number', description: 'Phí vận chuyển nếu có (0 nếu miễn phí ship)' },
        total_amount: { type: 'number', description: 'Tổng tiền thanh toán cuối cùng (VND)' },
        payment_method: { type: 'string', enum: ['COD', 'BANK_TRANSFER'], description: 'Phương thức thanh toán: COD (nhận hàng thanh toán) hoặc BANK_TRANSFER (chuyển khoản)' },
        note: { type: 'string', description: 'Ghi chú đơn hàng nếu có' },
      },
      required: ['customer_name', 'phone', 'address', 'items', 'total_amount'],
    },
  },
}

/**
 * Tra cứu đơn hàng của CHÍNH khách đang chat.
 *
 * KHÔNG nhận số điện thoại từ mô hình — cố ý. Nếu để mô hình truyền số thì chỉ
 * cần khách gõ "tra đơn của số 09xx" là xem được lịch sử mua hàng, địa chỉ và
 * hạng thẻ của người khác. Số điện thoại luôn lấy từ hồ sơ gắn với hội thoại,
 * tức là danh tính do hệ thống xác định chứ không do khách khai.
 */
export const LOOKUP_ORDER_TOOL = 'lookup_order'
const LOOKUP_ORDER_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: LOOKUP_ORDER_TOOL,
    description: 'Tra ĐƠN HÀNG của khách đang chat: trạng thái giao, đơn vị vận chuyển, sản phẩm, tổng tiền. Dùng khi khách hỏi "đơn của tôi đâu rồi", "bao giờ nhận được", "kiểm tra đơn". Hệ thống tự lấy đúng khách theo hồ sơ hội thoại — KHÔNG cần và KHÔNG được truyền số điện thoại.',
    parameters: {
      type: 'object',
      properties: {
        order_code: { type: 'string', description: 'Mã đơn khách nêu (vd "HD_0G6385M9"). Bỏ trống để xem các đơn gần nhất.' },
      },
      required: [],
    },
  },
}

/** Đơn hàng thành chữ cho mô hình đọc. Giữ nguyên tên trạng thái của CRM. */
export function formatOrders(
  orders: Array<Record<string, unknown>>,
  maDon?: string,
): string {
  const loc = maDon
    ? orders.filter((o) => String(o.order_code ?? '').toLowerCase().includes(maDon.toLowerCase()))
    : orders
  if (!loc.length) {
    return maDon
      ? `Không thấy đơn nào có mã "${maDon}" trên hồ sơ của khách này.`
      : 'Khách này chưa có đơn hàng nào trên hệ thống.'
  }
  const vnd = (n: unknown) => (typeof n === 'number' ? `${new Intl.NumberFormat('vi-VN').format(n)}đ` : '?')
  return loc.slice(0, 5).map((o) => {
    const items = Array.isArray(o.items)
      ? (o.items as Array<Record<string, unknown>>)
          .map((i) => `${i.name} x${i.quantity}`).join(', ')
      : ''
    const ngay = o.created_at ? String(o.created_at).slice(0, 10) : '?'
    return [
      `- Đơn ${o.order_code} (${ngay}) — TRẠNG THÁI: ${o.status ?? 'chưa rõ'}`,
      o.carrier ? `  Vận chuyển: ${o.carrier}` : '',
      items ? `  Hàng: ${items}` : '',
      `  Tổng: ${vnd(o.total_amount)}${o.shipping_fee ? ` (gồm ship ${vnd(o.shipping_fee)})` : ''}`,
    ].filter(Boolean).join('\n')
  }).join('\n')
}

/**
 * Gửi TÀI LIỆU trong thư viện bán hàng: biểu giá, hồ sơ chứng nhận, chính sách.
 *
 * Khác `send_product_image` ở chỗ đó là ảnh của một mặt hàng, còn đây là tài
 * liệu dùng chung. Trước khi có công cụ này, khách hỏi "cho xin bảng giá" thì
 * AI viết cả đoạn dài mô tả bằng chữ, trong khi thư viện có sẵn 5 tấm biểu giá
 * nằm đó mà không gửi được — hoặc tệ hơn, nó gọi nhầm sang gửi ảnh sản phẩm.
 */
export const SEND_DOC_TOOL = 'send_document'
const SEND_DOC_DEF: OpenaiToolDef = {
  type: 'function',
  function: {
    name: SEND_DOC_TOOL,
    description:
      'Gửi TÀI LIỆU có sẵn trong thư viện bán hàng cho khách: bảng giá / biểu giá, hồ sơ chứng nhận, ' +
      'chính sách, tài liệu giới thiệu. Dùng NGAY khi khách xin bảng giá, xin hồ sơ, xin giấy chứng nhận, ' +
      'xin tài liệu — gửi luôn thay vì mô tả dài bằng chữ. Không có tài liệu phù hợp thì công cụ báo lại.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Thứ khách cần, bằng tiếng Việt (vd "bảng giá tất cả sản phẩm", "hồ sơ chứng nhận")' },
        caption: { type: 'string', description: 'Lời nhắn ngắn gửi kèm (tuỳ chọn)' },
      },
      required: ['query'],
    },
  },
}

export function buildOpenaiTools(tools: ToolsConfig): OpenaiToolDef[] {
  const search = TOOL_NAMES.filter((n) => tools[n].enabled).map((n) => ({
    type: 'function' as const,
    function: { name: n, description: TOOL_SCHEMAS[n].description, parameters: { ...QUERY_PARAM } },
  }))
  // Overview only makes sense if the model can see some catalog data at all.
  const anySearch = TOOL_NAMES.some((n) => tools[n].enabled)
  // log_knowledge_gap is only meaningful when the AI can actually search knowledge
  // (no search tools → the auto-log can't fire anyway, so don't offer the tool).
  // Gửi ảnh chỉ có nghĩa khi AI tra được sản phẩm — không có search_products thì
  // nó không biết sản phẩm nào tồn tại để mà gửi.
  const canSendImage = tools.search_products?.enabled
  return [
    ...search,
    ...(anySearch ? [CATALOG_OVERVIEW_DEF, LOG_GAP_DEF] : []),
    ...(canSendImage ? [SEND_IMAGE_DEF] : []),
    HANDOFF_DEF, APPOINTMENT_DEF, ORDER_DEF, LOOKUP_ORDER_DEF, SEND_DOC_DEF,
  ]
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as string[]).includes(name)
}

const MAX_SNIPPET = 800
const MAX_PRICE_DESC = 1000 // 'description' pricing lives in the text — give it room

function formatProducts(rows: Array<{ name: string; price: number | null; priceMax: number | null; priceType: string; currency: string; description: string | null }>): string {
  if (rows.length === 0) return 'Không tìm thấy sản phẩm phù hợp trong phạm vi cho phép.'
  return rows.map((p) => {
    const price = formatProductPrice(p)
    // 'description' products carry their price inside the text — don't clip it away.
    const cap = p.priceType === 'description' ? MAX_PRICE_DESC : MAX_SNIPPET
    return `- ${p.name} — ${price}${p.description ? `: ${p.description.slice(0, cap)}` : ''}`
  }).join('\n')
}

function formatKb(rows: Array<{ title: string; content: string }>): string {
  if (rows.length === 0) return 'Không tìm thấy thông tin phù hợp trong phạm vi cho phép.'
  return rows.map((s) => `### ${s.title}\n${s.content.slice(0, MAX_SNIPPET)}`).join('\n\n')
}

/** Filter aggregate rows by a guardrail allow-list (empty = all categories). */
function scopeRows(
  rows: Array<{ categoryId: string | null; category: string | null; count: number }>,
  allowed: string[],
): Array<{ category: string; count: number }> {
  return rows
    .filter((r) => allowed.length === 0 || (r.categoryId != null && allowed.includes(r.categoryId)))
    .filter((r) => r.count > 0)
    .map((r) => ({ category: r.category ?? 'Chưa phân loại', count: r.count }))
}

async function formatOverview(orgId: string, tools: ToolsConfig): Promise<string> {
  const agg = await aggregate(orgId)
  const lines: string[] = []
  if (tools.search_products.enabled) {
    const prod = scopeRows(agg.productsByCategory, tools.search_products.guardrail.categoryIds)
    const total = prod.reduce((a, b) => a + b.count, 0)
    if (total > 0) lines.push(`SẢN PHẨM (tổng ${total}):\n${prod.map((p) => `• ${p.category}: ${p.count}`).join('\n')}`)
  }
  const knowIds = tools.search_knowledge.guardrail.categoryIds
  if (tools.search_knowledge.enabled) {
    const kb = scopeRows(agg.knowledgeByCategory, knowIds)
    const total = kb.reduce((a, b) => a + b.count, 0)
    if (total > 0) lines.push(`KIẾN THỨC/FAQ (tổng ${total}):\n${kb.map((k) => `• ${k.category}: ${k.count}`).join('\n')}`)
  }
  if (lines.length === 0) return 'Chưa có dữ liệu danh mục trong phạm vi được cấp.'
  return `Tổng quan danh mục trong phạm vi được cấp:\n${lines.join('\n\n')}\n(Dùng search_products/search_knowledge để xem chi tiết từng nhóm.)`
}

/** One retrieved hit surfaced for observability (label + relevance score). */
export type ToolHit = { label: string; score: number | null }
/** Tool execution result: the text the model sees + per-hit scores for the trace. */
export type ToolResult = { text: string; hits: ToolHit[] }

/**
 * Execute a tool call. Always enforces the tool's guardrail (categoryIds) in code,
 * so the model cannot reach data outside its allowed scope. Returns the text the
 * model sees plus per-hit relevance scores (recorded in the trace so the Master
 * can diagnose retrieval quality). `minScore` overrides the default RAG threshold.
 */
export interface ResolvedProductImage {
  productId: string
  productName: string
  imageUrl: string
}

/**
 * Kết quả tra ảnh. Phân biệt "không có sản phẩm" với "có sản phẩm nhưng ảnh
 * hỏng" — hai tình huống này cần AI nói với khách hai kiểu khác nhau, và nếu
 * gộp làm một thì mô hình hay cãi lại ("search_products vừa thấy sản phẩm mà").
 */
export type ProductImageLookup =
  | { status: 'ok'; image: ResolvedProductImage }
  | { status: 'no_image'; productName: string }
  | { status: 'not_found' }

/**
 * Tra sản phẩm theo tên/mã rồi lấy ảnh ĐÃ DUYỆT đầu tiên.
 *
 * Chỉ nhận sản phẩm status='active' — giống hệt luật của thư viện tài liệu.
 * Trả về null nếu không tìm thấy hoặc sản phẩm chưa có ảnh; khi đó AI được báo
 * lại để nó tự nói với khách thay vì im lặng.
 */
/** Tài liệu trong thư viện có tệp gửi được cho khách. */
export interface TaiLieuGuiDuoc {
  id: string
  title: string
  fileUrl: string
}

/**
 * Tìm tài liệu khớp yêu cầu và có tệp thật để gửi.
 *
 * Dùng chung bộ xếp hạng của thư viện nên "bảng giá" khớp được tài liệu đặt tên
 * "Biểu giá". Không có tệp thì coi như không gửi được — thà báo không có còn
 * hơn gửi một bản ghi rỗng.
 */
export async function timTaiLieuGui(orgId: string, query: string): Promise<TaiLieuGuiDuoc[]> {
  const rows = await retrieveDocAssets(orgId, query, 5)
  const ids = rows.filter((r) => r.sendable).map((r) => r.id)
  if (!ids.length) return []
  const day = await prisma.docAsset.findMany({
    where: { orgId, id: { in: ids }, visibility: 'sales' },
    select: { id: true, title: true, fileUrl: true, images: true },
  })
  const thuTu = new Map(ids.map((id, i) => [id, i]))
  return day
    .map((d) => ({ id: d.id, title: d.title, fileUrl: d.fileUrl || d.images[0] || '' }))
    .filter((d) => !!d.fileUrl)
    .sort((a, b) => (thuTu.get(a.id) ?? 99) - (thuTu.get(b.id) ?? 99))
}

export async function resolveProductImage(
  orgId: string,
  query: string,
): Promise<ProductImageLookup> {
  const q = (query || '').trim()
  if (!q) return { status: 'not_found' }

  // Tìm trong TÀI LIỆU SẢN PHẨM, không tìm trong bảng `products` nội bộ.
  //
  // Bảng nội bộ là danh mục cũ 49 dòng, còn lẫn cả đồ thể dục thể thao. Cộng
  // với một nhánh dự phòng "câu hỏi chung chung thì lấy đại sản phẩm nào có
  // ảnh", kết quả là khách hỏi "có ảnh bảng giá không" lại nhận được ảnh máy
  // massage. Đã xảy ra thật.
  //
  // Tài liệu sản phẩm bám theo danh mục đang bán và ảnh là tệp thật đã tải lên.
  const docs = await retrieveProductDocs(orgId, q, 5)

  for (const d of docs) {
    for (const url of d.images ?? []) {
      if (url && await isImageAvailable(url)) {
        return { status: 'ok', image: { productId: d.productCode, productName: d.name ?? d.productCode, imageUrl: url } }
      }
    }
  }

  // Không khớp sản phẩm nào thì BÁO KHÔNG TÌM THẤY, tuyệt đối không gửi đại một
  // tấm. Gửi nhầm ảnh còn tệ hơn không gửi: khách tưởng shop bán thứ đó.
  const dau = docs[0]
  if (dau) return { status: 'no_image', productName: dau.name ?? dau.productCode }
  return { status: 'not_found' }
}

export async function executeTool(
  orgId: string,
  name: string,
  args: unknown,
  tools: ToolsConfig,
  topK: number,
  minScore?: number,
): Promise<ToolResult> {
  if (name === CATALOG_OVERVIEW_TOOL) return { text: await formatOverview(orgId, tools), hits: [] }
  if (!isToolName(name)) return { text: `Công cụ không tồn tại: ${name}`, hits: [] }
  const tool = tools[name]
  if (!tool.enabled) return { text: 'Công cụ này hiện đang tắt.', hits: [] }
  const query = typeof (args as { query?: unknown })?.query === 'string' ? (args as { query: string }).query.trim() : ''
  if (!query) return { text: 'Thiếu tham số "query".', hits: [] }
  const ids = tool.guardrail.categoryIds

  if (name === 'search_products') {
    const rows = await retrieveProductSemantic(orgId, query, topK, { categoryIds: ids, minScore })
    const hits = rows.map((r) => ({ label: r.name, score: r.score ?? null }))
    return { text: rows.length === 0 ? notFoundMsg(ids, 'sản phẩm') : formatProducts(rows), hits }
  }
  // search_knowledge covers ALL KB formats (FAQ + articles) in ONE query — no format
  // split, so the model can never mis-route between two near-identical knowledge tools.
  const fb = (o: string, q: string, k: number) => retrieveKb(o, q, k, { categoryIds: ids })
  const rows = await retrieveKbSemantic(orgId, query, topK, fb, { categoryIds: ids, minScore })
  const hits = rows.map((r) => ({ label: r.title, score: r.score ?? null }))
  return { text: rows.length === 0 ? notFoundMsg(ids, 'thông tin') : formatKb(rows), hits }
}

/**
 * Scope-aware "no result" message. With an active guardrail (restricted
 * categories) "not found" might just mean OUT OF SCOPE — the model must NOT turn
 * that into a false denial. With full scope it can safely say the shop doesn't
 * carry it.
 */
function notFoundMsg(guardrailIds: string[], kind: string): string {
  return guardrailIds.length > 0
    ? `Không tra cứu được ${kind} phù hợp trong phạm vi được cấp. Phần này CÓ THỂ nằm ngoài phạm vi bạn được phép tra — KHÔNG kết luận shop không có; nói sẽ kiểm tra lại rồi báo khách.`
    : `Không tìm thấy ${kind} phù hợp trong danh mục hiện có của shop.`
}
