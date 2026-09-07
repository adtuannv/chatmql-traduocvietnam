/**
 * product-tours.ts — Kịch bản các tour tương tác.
 *
 * Mỗi bước trỏ vào một mốc `data-tour` có thật trên giao diện. Thêm bước mới
 * thì phải gắn mốc tương ứng, đừng neo vào class — class đổi theo thiết kế.
 *
 * Tour không thay được phần đọc trong HDSD: tour dạy "bấm ở đâu", phần đọc nói
 * "vì sao và tránh gì". Module nào có màn hình để chỉ thì mới có tour.
 */
import type { TourDef } from '@/components/shared/product-tour'

export const TOURS: Record<string, TourDef> = {
  /**
   * Tour Hội thoại — đi ba tầng, đúng cách dạy việc cho người mới:
   *   A. Tổng quan bố cục: màn này có mấy vùng, mỗi vùng để làm gì.
   *   B–D. Từng vị trí chức năng: đi vào từng vùng, chỉ từng nút.
   *   E. Luồng một ca làm việc: ghép lại thành trình tự dùng thật.
   * Chia chương để người học biết đang ở đâu và còn bao nhiêu.
   */
  conversations: {
    id: 'conversations',
    label: 'Hội thoại',
    steps: [
      // ── A. Tổng quan bố cục ──────────────────────────────────────
      {
        section: 'Tổng quan',
        route: '/conversations',
        title: 'Màn Hội thoại có bốn vùng',
        body: 'Từ trái sang phải: cột lọc, danh sách hội thoại, khung chat, và cột hồ sơ khách. Cả ngày làm việc của sale diễn ra trong bốn vùng này. Tour sẽ đi qua từng vùng rồi mới vào từng nút.',
      },
      {
        section: 'Tổng quan',
        selector: '[data-tour="conv-filters"]',
        title: 'Vùng 1 — Cột lọc: quyết định xem gì',
        body: 'Cột biểu tượng sát trái. Nó không mở hội thoại nào cả, chỉ quyết định danh sách bên cạnh hiện những ai. Đây là chỗ bắt đầu mỗi ca.',
        pad: 8,
      },
      {
        section: 'Tổng quan',
        selector: '[data-tour="conv-list"]',
        title: 'Vùng 2 — Danh sách: chọn khách để nói chuyện',
        body: 'Danh sách khách theo bộ lọc đang chọn, mới nhất lên trên. Mỗi dòng cho biết khách là ai, đến từ kênh nào, câu cuối là gì và cách đây bao lâu.',
        pad: 4,
      },
      {
        section: 'Tổng quan',
        selector: '[data-tour="chat-input"]',
        title: 'Vùng 3 — Khung chat: nơi trao đổi',
        body: 'Toàn bộ tin nhắn hai chiều, thanh công cụ bán hàng và ô soạn tin. Đây là vùng dùng nhiều nhất.',
        missingHint: 'Chọn một hội thoại ở danh sách bên trái rồi bấm Tiếp.',
      },
      {
        section: 'Tổng quan',
        selector: '[data-tour="crm-tabs"]',
        title: 'Vùng 4 — Cột phải: biết mình đang nói với ai',
        body: 'Hồ sơ khách lấy từ CRM, form tạo đơn và danh mục sản phẩm. Ba tab này giúp không phải rời màn hình khi chốt đơn.',
        missingHint: 'Cột phải chỉ hiện khi đang mở một hội thoại và cửa sổ đủ rộng. Chọn một hội thoại, phóng to cửa sổ nếu cần, rồi bấm Tiếp.',
        pad: 8,
      },

      // ── B. Tìm và chọn khách ─────────────────────────────────────
      {
        section: 'Tìm và chọn khách',
        selector: '[data-tour="conv-filters"]',
        title: 'Năm bộ lọc, dùng theo thời điểm trong ca',
        body: 'Từ trên xuống: Tất cả · Chưa đọc · Chưa trả lời · AI tư vấn. Đầu ca mở "Chưa trả lời" để không ai bị bỏ quên; cuối ca mở "AI tư vấn" xem lại những cuộc AI đã tự trả lời. Con số đỏ là số hội thoại đang nằm trong bộ lọc đó.',
        pad: 8,
      },
      {
        section: 'Tìm và chọn khách',
        selector: '[data-tour="conv-search"]',
        title: 'Tìm khách theo tên hoặc số điện thoại',
        body: 'Khách gọi điện rồi nhắn tin thì tìm bằng số nhanh hơn là cuộn danh sách. Ô này tìm trong tên và số điện thoại của mọi hội thoại, không phụ thuộc bộ lọc đang chọn.',
        missingHint: 'Ô tìm kiếm nằm trên đầu danh sách hội thoại.',
      },
      {
        section: 'Tìm và chọn khách',
        selector: '[data-tour="conv-list"]',
        title: 'Đọc một dòng hội thoại',
        body: 'Biểu tượng nhỏ ở góc avatar cho biết kênh: Zalo cá nhân, Zalo OA hay web chat. Chữ đậm là chưa đọc. Dòng dưới là câu cuối cùng, có chữ "Bạn:" nghĩa là bên mình nói sau cùng — tức khách chưa trả lời chứ không phải mình đang nợ khách.',
        pad: 4,
      },

      // ── C. Khung chat ────────────────────────────────────────────
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-header-tools"]',
        title: 'Cụm công cụ đầu hội thoại',
        body: 'Bốn thứ ở đây phục vụ việc tra cứu chứ không phải gửi tin: tìm trong hội thoại, thư viện tệp đã trao đổi, kéo lịch sử cũ từ Zalo, và chế độ AI. Tour sẽ chỉ hai cái quan trọng nhất.',
        missingHint: 'Mở một hội thoại để thấy thanh công cụ đầu trang.',
        pad: 8,
      },
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-library"]',
        title: 'Thư viện: mọi ảnh và tệp đã trao đổi',
        body: 'Khách hỏi "cái ảnh hôm trước em gửi đâu rồi" thì mở đây, nhanh hơn cuộn ngược lịch sử. Gom cả ảnh, tệp và đường dẫn của riêng hội thoại này.',
        missingHint: 'Mở một hội thoại ở danh sách bên trái rồi bấm Tiếp.',
      },
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-ai-mode"]',
        title: 'Chế độ AI — ba mức, chọn theo khách',
        body: 'Tự động: AI trả lời thẳng cho khách, hợp giờ đêm và câu hỏi lặp. Gợi ý: AI soạn sẵn, mình đọc rồi mới gửi. Tắt: chỉ người trả lời. Menu này còn có "Tạm dừng AI" theo mốc phút, dùng khi mình đang trực tiếp xử lý một ca khó và không muốn AI chen vào.',
        missingHint: 'Mở một hội thoại ở danh sách bên trái rồi bấm Tiếp.',
      },
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-msg-filters"]',
        title: 'Lọc tin theo người nói',
        body: 'Tất cả · Khách · AI · Nhân viên. Nhận bàn giao một hội thoại dài thì lọc "Khách" để đọc một mạch xem khách thực sự cần gì, khỏi bị chen bởi những câu đáp lễ.',
        missingHint: 'Mở một hội thoại để thấy hàng lọc tin nhắn.',
        pad: 4,
      },
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-input"]',
        title: 'Ô soạn tin',
        body: 'Enter là gửi, Shift+Enter là xuống dòng. Gõ tiếng Việt bằng Telex hay VNI đều được — hệ thống đợi bộ gõ chốt xong ký tự cuối rồi mới gửi, nên không bị mất dấu.',
      },
      {
        section: 'Khung chat',
        selector: '[data-tour="chat-send"]',
        title: 'Nút gửi đổi màu theo nơi tin sẽ tới',
        body: 'Xanh "Gửi khách hàng" là tin đi ra ngoài cho khách. Nếu đang ở chế độ ghi chú nội bộ, nút đổi màu và đổi chữ. Đây là chốt chống gửi nhầm: trước khi bấm, liếc chữ trên nút một lần.',
        missingHint: 'Mở một hội thoại ở danh sách bên trái rồi bấm Tiếp.',
      },

      // ── D. Công cụ bán hàng ──────────────────────────────────────
      {
        section: 'Công cụ bán hàng',
        selector: '[data-tour="chat-image"]',
        title: 'Gửi ảnh và tệp từ máy',
        body: 'Hai nút đầu thanh công cụ để gửi ảnh chụp màn hình hoặc tệp lẻ. Ảnh sản phẩm chính thức thì đừng gửi từ máy — dùng Tài liệu bán hàng để luôn gửi đúng ảnh đã duyệt.',
        missingHint: 'Mở một hội thoại để thấy thanh công cụ.',
      },
      {
        section: 'Công cụ bán hàng',
        selector: '[data-tour="chat-docs"]',
        title: 'Tài liệu bán hàng — kho ảnh, mô tả, video đã duyệt',
        body: 'Bấm mở ra kho tài liệu. Bước một chọn sản phẩm hoặc tài liệu chung; bước hai tick đúng phần muốn gửi và xem trước chính xác những tin khách sẽ nhận. Đừng gửi cả bộ mười tấm ảnh — ba tấm đúng trọng tâm thuyết phục hơn.',
        missingHint: 'Mở một hội thoại để thấy nút Tài liệu bán hàng.',
        clickToAdvance: true,
      },
      {
        section: 'Công cụ bán hàng',
        selector: '[data-tour="chat-ai-suggest"]',
        title: 'AI Gợi ý — nhờ AI soạn hộ một câu',
        body: 'Dùng khi bí cách trả lời hoặc cần viết lại cho lịch sự hơn. AI soạn dựa trên lịch sử hội thoại và tài liệu nội bộ, mình đọc rồi mới gửi. Khác với chế độ Tự động ở chỗ mình vẫn là người bấm gửi.',
        missingHint: 'Mở một hội thoại ở danh sách bên trái rồi bấm Tiếp.',
      },
      {
        section: 'Công cụ bán hàng',
        selector: '[data-tour="chat-order"]',
        title: 'Lên đơn — chốt ngay không rời màn hình',
        body: 'Khách đồng ý mua thì bấm đây, cột phải nhảy sang tab Tạo đơn với thông tin khách điền sẵn. Tạo xong, hệ thống soạn một phiếu bán hàng đầy đủ để gửi lại cho khách xác nhận.',
        missingHint: 'Mở một hội thoại để thấy nút Lên đơn.',
      },

      // ── E. Cột hồ sơ khách ───────────────────────────────────────
      {
        section: 'Hồ sơ khách',
        selector: '[data-tour="crm-tabs"]',
        title: 'Ba tab của cột phải',
        body: 'Thông tin là hồ sơ khách; Tạo đơn là form chốt đơn; Sản phẩm là danh mục hàng để gửi nhanh link đặt hàng. Ghi chú nhanh không nằm ở đây mà là nút hình quyển sổ bên dưới.',
        missingHint: 'Cột phải cần một hội thoại đang mở và cửa sổ đủ rộng.',
        pad: 8,
      },
      {
        section: 'Hồ sơ khách',
        selector: '[data-tour="crm-head"]',
        prepareClick: '[data-tour="crm-tabs"] button',
        title: 'Hạng hội viên và hai nút bên phải',
        body: 'Thẻ cạnh tiêu đề là hạng hội viên, tính theo tổng chi tiêu và giá trị đơn trung bình — căn cứ để áp ưu đãi, nên xem trước khi hứa gì với khách. Nút quyển sổ mở ghi chú nhanh của hội thoại; nút mũi tên vòng đồng bộ lại hồ sơ khi CRM vừa đổi.',
        pad: 6,
        missingHint: 'Phần này chỉ hiện khi khách đã có số điện thoại và liên kết được hồ sơ CRM. Mở một hội thoại có hồ sơ rồi bấm Tiếp.',
      },
      {
        section: 'Hồ sơ khách',
        selector: '[data-tour="crm-stats"]',
        prepareClick: '[data-tour="crm-tabs"] button',
        title: 'Bốn ô số liệu',
        body: 'Lịch bán hàng và lịch chăm sóc là hẹn đã đặt với khách — đến hạn mà chưa liên hệ là mất điểm. Số đơn và số ghi chú cho biết khách này đã mua bao nhiêu lần và đội mình đã ghi lại gì.',
        pad: 4,
        missingHint: 'Phần này chỉ hiện khi khách đã có số điện thoại và liên kết được hồ sơ CRM. Mở một hội thoại có hồ sơ rồi bấm Tiếp.',
      },
      {
        section: 'Hồ sơ khách',
        selector: '[data-tour="crm-actions"]',
        prepareClick: '[data-tour="crm-tabs"] button',
        title: 'Hai nút dưới đáy cột',
        body: 'Xem hồ sơ lịch sử mua hàng mở toàn bộ đơn cũ của khách. Phân tích khách hàng (AI) đọc lịch sử rồi tóm tắt khách này thích gì, mua theo chu kỳ nào — dùng trước khi gọi lại một khách lâu không mua.',
        pad: 4,
        missingHint: 'Phần này chỉ hiện khi khách đã có số điện thoại và liên kết được hồ sơ CRM. Mở một hội thoại có hồ sơ rồi bấm Tiếp.',
      },

      // ── Kết ──────────────────────────────────────────────────────
      {
        section: 'Ghép lại',
        title: 'Trình tự một ca làm việc',
        body: 'Mở "Chưa trả lời" → chọn khách → đọc cột phải xem khách là ai → trả lời, cần thì gửi Tài liệu bán hàng → khách đồng ý thì Lên đơn → gửi phiếu xác nhận. Cuối ca mở "AI tư vấn" xem lại những cuộc AI đã tự trả lời. Mở lại tour này bất cứ lúc nào ở nút HDSD.',
      },
    ],
  },

  products: {
    id: 'products',
    label: 'Sản phẩm',
    steps: [
      {
        route: '/conversations',
        selector: '[data-tour="crm-tabs"]',
        title: 'Tab Sản phẩm nằm cạnh Tạo đơn',
        body: 'Khách hỏi giá giữa cuộc trò chuyện thì mở tab này, không cần rời màn hình.',
        missingHint: 'Chọn một hội thoại và phóng to cửa sổ để cột phải hiện ra, rồi bấm Tiếp.',
        pad: 8,
      },
      {
        route: '/crm-products',
        title: 'Danh mục đầy đủ ở trang riêng',
        body: 'Cần xem cả kho hàng thì vào trang Sản phẩm. Dữ liệu đồng bộ từ hệ thống nguồn nên giá và tồn kho luôn khớp, không có bản sao cũ.',
      },
      {
        selector: '[data-tour="nav-sales-docs"]',
        title: 'Kiến thức sản phẩm ở chỗ khác',
        body: 'Ảnh, mô tả và video để tư vấn nằm trong Tài liệu bán hàng, ghép với sản phẩm bằng mã. Sản phẩm lo giá và tồn, tài liệu lo nội dung bán hàng.',
        missingHint: 'Cửa sổ hẹp nên mục này nằm trong menu "Xem thêm".',
      },
    ],
  },

  'sales-docs': {
    id: 'sales-docs',
    label: 'Tài liệu bán hàng',
    steps: [
      {
        route: '/sales-docs',
        title: 'Đi từ tổng quan xuống chi tiết',
        body: 'Trang mở ra theo đúng cách người bán hàng nghĩ: biểu giá tổng trước, rồi danh mục sản phẩm, rồi từng sản phẩm với ảnh, mô tả và video.',
      },
      {
        route: '/conversations',
        selector: '[data-tour="chat-docs"]',
        title: 'Gửi khách từ trong khung chat',
        body: 'Bấm vào đây khi đang chat. Bước một chọn thứ cần gửi, bước hai tick đúng phần muốn gửi và xem trước tin khách sẽ nhận.',
        missingHint: 'Mở một hội thoại trước, thanh công cụ mới hiện.',
        clickToAdvance: true,
      },
    ],
  },
}

/** Module nào có tour tương tác. */
export function tourFor(moduleId: string): TourDef | null {
  return TOURS[moduleId] ?? null
}
