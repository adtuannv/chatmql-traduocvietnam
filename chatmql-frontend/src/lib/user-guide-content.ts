/**
 * user-guide-content.ts — Nội dung hướng dẫn sử dụng, tách khỏi giao diện.
 *
 * Để riêng dữ liệu vì phần chữ là thứ đội nghiệp vụ sẽ sửa nhiều nhất, còn
 * khung hiển thị thì gần như không đổi — sửa chữ không phải đụng vào React.
 *
 * Viết theo việc nhân viên phải làm, không theo tên nút trên màn hình: người
 * mới cần biết "chốt đơn cho khách" gồm mấy bước, chứ không cần biết hệ thống
 * có bao nhiêu tab.
 */
import {
  Bot, Database, FolderOpen, LayoutDashboard, MessageSquare, PackageSearch,
  ShoppingCart, Users, Zap, type LucideIcon,
} from 'lucide-react'

export interface GuideStep {
  title: string
  /** Một đoạn dẫn: vì sao có bước này, không phải mô tả nút. */
  body: string
  /** Các ý cần nhớ. */
  points?: string[]
  /** Điều cần tránh — chỗ nhân viên mới hay sai. */
  warning?: string
  /** Đường dẫn để mở thẳng màn hình đang nói tới. */
  to?: string
}

export interface GuideModule {
  id: string
  label: string
  icon: LucideIcon
  /** Một câu nói rõ module này để làm gì. */
  summary: string
  steps: GuideStep[]
}

export const GUIDE_MODULES: GuideModule[] = [
  {
    id: 'conversations',
    label: 'Hội thoại',
    icon: MessageSquare,
    summary: 'Nơi làm việc chính: đọc tin khách, trả lời, và gọi mọi công cụ bán hàng.',
    steps: [
      {
        title: 'Chọn đúng hộp thư trước khi trả lời',
        body: 'Cột trái gom tất cả kênh về một chỗ. Bộ lọc phía trên giúp không bỏ sót khách đang chờ.',
        points: [
          '"Chưa trả lời" là danh sách cần xử lý trước tiên trong ca.',
          '"AI tư vấn" lọc riêng những hội thoại đang để AI tự trả lời, nên xem lại cuối ca.',
          'Biểu tượng nhỏ ở avatar cho biết khách đến từ Zalo cá nhân, OA hay web chat.',
        ],
        to: '/conversations',
      },
      {
        title: 'Đọc cột phải trước khi gõ câu đầu tiên',
        body: 'Cột phải là hồ sơ khách lấy thẳng từ CRM. Nhìn hạng hội viên và lịch sử mua trước khi chào là cách nhanh nhất để không hỏi lại điều khách đã nói.',
        points: [
          'Thẻ hạng hội viên nằm ngay cạnh tiêu đề "Thông tin từ CRM".',
          'Nút hình quyển sổ mở ghi chú nhanh của hội thoại này.',
          'Nút mũi tên vòng đồng bộ lại hồ sơ khi CRM vừa được cập nhật.',
        ],
        warning: 'Khách chưa có số điện thoại thì CRM chưa tra được. Nhập số ở tab Tạo đơn, hệ thống sẽ tự lưu vào hồ sơ.',
      },
      {
        title: 'Chế độ AI: tự động, gợi ý hay tắt',
        body: 'Mỗi hội thoại chọn được cách AI tham gia. Nút chế độ nằm ở đầu khung chat.',
        points: [
          'Tự động — AI trả lời thẳng cho khách, hợp giờ đêm và câu hỏi lặp.',
          'Gợi ý — AI soạn sẵn, nhân viên đọc rồi mới gửi.',
          'Tắt — chỉ người trả lời.',
        ],
        warning: 'Trước khi bật tự động cho một khách quan trọng, hãy đọc vài câu AI đã trả lời khách khác để chắc giọng văn phù hợp.',
      },
      {
        title: 'Gửi tài liệu và sản phẩm ngay trong khung chat',
        body: 'Không cần mở tab khác: nút "Tài liệu bán hàng" ở thanh soạn tin và tab "Sản phẩm" ở cột phải phục vụ hai tình huống khác nhau.',
        points: [
          'Cần gửi ảnh, mô tả, video chi tiết → dùng Tài liệu bán hàng.',
          'Khách chỉ hỏi giá và muốn đặt luôn → dùng tab Sản phẩm, gửi link Mini App.',
        ],
      },
    ],
  },
  {
    id: 'order',
    label: 'Tạo đơn',
    icon: ShoppingCart,
    summary: 'Chốt đơn ngay trong hội thoại, đơn đẩy thẳng sang CRM và gửi bill cho khách.',
    steps: [
      {
        title: 'Kiểm tra thông tin nhận hàng',
        body: 'Tên, số điện thoại và địa chỉ lấy sẵn từ hồ sơ khách. Đây là chỗ sai nhiều nhất nên đọc lại một lượt trước khi thêm hàng.',
        warning: 'Sai số điện thoại là đơn không giao được và CRM cũng không gắn đúng khách.',
      },
      {
        title: 'Thêm hàng và quà tặng ở hai ô riêng',
        body: 'Ô tìm sản phẩm và ô tìm quà tặng tách riêng, đúng như cách CRM ghi nhận. Quà tặng không tính tiền nhưng vẫn phải có trong đơn để kho soạn đủ.',
        points: [
          'Chọn đúng kho và loại đơn — hai thứ này quyết định phí vận chuyển.',
          'Phí ship hệ thống tự tính theo quy tắc của CRM, chỉ sửa khi có lý do.',
        ],
      },
      {
        title: 'Chọn hình thức thanh toán',
        body: 'Thanh toán khi nhận hàng hoặc chuyển khoản. Chọn chuyển khoản thì hệ thống kèm mã QR vào tin gửi khách.',
        points: ['Khách đã cọc thì nhập số tiền cọc, bill sẽ ghi rõ còn phải thu bao nhiêu.'],
      },
      {
        title: 'Tạo đơn và gửi bill xác nhận',
        body: 'Tạo xong, hệ thống soạn sẵn một phiếu bán hàng đầy đủ để gửi khách qua chính hội thoại đang mở: thông tin công ty, mã đơn, danh sách hàng, tiền hàng, phí ship, tổng thanh toán và cách lấy hoá đơn đỏ.',
        warning: 'Đọc lại bill trước khi gửi. Đây là tin khách sẽ lưu lại và đối chiếu khi nhận hàng.',
      },
    ],
  },
  {
    id: 'products',
    label: 'Sản phẩm',
    icon: PackageSearch,
    summary: 'Danh mục hàng hoá đồng bộ từ hệ thống nguồn; gửi khách link Mini App để tự đặt.',
    steps: [
      {
        title: 'Dữ liệu sản phẩm đến từ đâu',
        body: 'Danh sách không nhập tay trong phần mềm này mà lấy từ hệ thống sản phẩm của công ty. Giá và tồn kho vì thế luôn khớp với nguồn, không có bản sao cũ.',
        points: ['Hàng ngừng bán tự động ẩn khỏi danh sách gửi khách.'],
        to: '/crm-products',
      },
      {
        title: 'Gửi thẻ sản phẩm cho khách',
        body: 'Ở cột phải màn Hội thoại, tab "Sản phẩm" hiện từng thẻ hàng ngang có ảnh và giá. Bấm Gửi là khách nhận được tên, giá và một đường dẫn Mini App để xem chi tiết rồi đặt luôn.',
        points: ['Ô tìm kiếm nhận cả tên lẫn mã sản phẩm.'],
      },
      {
        title: 'Khi nút Gửi bị khoá',
        body: 'Nút khoá nghĩa là hệ thống chưa dựng được đường dẫn Mini App cho sản phẩm đó, và thẻ ghi rõ đang thiếu gì.',
        points: [
          '"Thiếu mã SP" — sản phẩm chưa có mã trong hệ thống nguồn, cần bổ sung.',
          '"Chưa có link" — máy chủ chưa được cấu hình địa chỉ Mini App.',
        ],
        warning: 'Hệ thống cố tình khoá thay vì gửi đường dẫn rỗng, vì khách bấm vào không ra gì còn tệ hơn là không nhận được link.',
      },
    ],
  },
  {
    id: 'sales-docs',
    label: 'Tài liệu bán hàng',
    icon: FolderOpen,
    summary: 'Kho ảnh, mô tả, video, biểu giá đã duyệt — chọn đúng phần cần rồi gửi khách.',
    steps: [
      {
        title: 'Đi từ tổng quan xuống chi tiết',
        body: 'Trang tài liệu mở ra theo đúng cách người bán hàng nghĩ: biểu giá tổng trước, rồi tới danh mục sản phẩm, rồi từng sản phẩm với ảnh, mô tả và video.',
        to: '/sales-docs',
      },
      {
        title: 'Gửi khách: chọn rồi soạn gói',
        body: 'Từ khung chat bấm "Tài liệu bán hàng". Bước một chọn thứ cần gửi, bước hai chọn đúng phần muốn gửi đi.',
        points: [
          'Tick riêng phần giới thiệu kèm giá, từng tấm ảnh, và video.',
          'Thêm một lời nhắn mở đầu để tin không đến đột ngột.',
          'Cột bên phải hiện đúng những tin khách sẽ nhận, theo đúng thứ tự.',
        ],
        warning: 'Đừng gửi cả bộ mười tấm ảnh. Ba tấm đúng trọng tâm thuyết phục hơn và không làm khách bị dội chuông.',
      },
      {
        title: 'Sửa nội dung thì vào trang quản lý',
        body: 'Ở màn hội thoại chỉ xem, chọn và gửi — không sửa trực tiếp, để không ai vô tình đổi tài liệu chung khi đang vội. Nút "Quản lý" mở trang quản trị ở tab mới.',
        points: ['Tài liệu để chế độ nội bộ sẽ không hiện ở màn gửi khách, và máy chủ cũng chặn gửi.'],
      },
    ],
  },
  {
    id: 'ai',
    label: 'AI',
    icon: Bot,
    summary: 'Đội AI trả lời khách, và trợ lý nội bộ để nhân viên tra cứu.',
    steps: [
      {
        title: 'Trợ lý nội bộ cho nhân viên',
        body: 'Tab hình con bot ở thanh bên trái mở một khung chat riêng cho nhân viên: hỏi về sản phẩm, chính sách, quy trình. Trợ lý chỉ đọc dữ liệu nội bộ nên trả lời bám theo tài liệu công ty.',
        points: ['Chọn được bot muốn hỏi trong danh sách đội AI.'],
        warning: 'Đây là chỗ tra cứu cho nhân viên, không phải nơi soạn tin gửi khách.',
      },
      {
        title: 'AI đọc gì để trả lời khách',
        body: 'AI ghép nhiều lớp dữ liệu: kiến thức chung, tài liệu bán hàng, hồ sơ khách, ghi chú nội bộ và lịch sử hội thoại. Tài liệu càng đầy đủ thì câu trả lời càng đúng.',
        points: ['Muốn AI tư vấn tốt hơn thì bổ sung tài liệu bán hàng, không phải sửa câu lệnh.'],
      },
      {
        title: 'Quản lý đội AI',
        body: 'Mỗi bot có tính cách, kịch bản và kênh riêng. Sửa ở trang AI.',
        to: '/ai',
      },
    ],
  },
  {
    id: 'customers',
    label: 'Khách hàng',
    icon: Users,
    summary: 'Danh sách khách, hồ sơ đầy đủ và lịch sử mua hàng.',
    steps: [
      {
        title: 'Tìm khách và xem hồ sơ',
        body: 'Tra theo tên hoặc số điện thoại. Hồ sơ gộp dữ liệu từ CRM và dữ liệu hội thoại của phần mềm này.',
        to: '/customers',
      },
      {
        title: 'Hạng hội viên và điểm tích luỹ',
        body: 'Hạng tính theo tổng chi tiêu và giá trị đơn trung bình. Đây là căn cứ để áp ưu đãi, nên kiểm tra trước khi hứa với khách.',
      },
    ],
  },
  {
    id: 'automation',
    label: 'Tự động hoá',
    icon: Zap,
    summary: 'Đặt quy tắc để hệ thống tự làm việc lặp lại.',
    steps: [
      {
        title: 'Quy tắc hoạt động thế nào',
        body: 'Mỗi quy tắc gồm một sự kiện kích hoạt và các việc cần làm. Ví dụ khách nhắn lần đầu thì gắn thẻ và giao cho một nhân viên.',
        to: '/automation',
      },
      {
        title: 'Thử trước khi bật rộng',
        body: 'Bật cho một nhóm nhỏ và theo dõi vài ngày. Quy tắc sai sẽ nhân bản lỗi ra toàn bộ khách rất nhanh.',
        warning: 'Cẩn thận với quy tắc tự gửi tin: một cấu hình sai có thể nhắn hàng loạt cho khách thật.',
      },
    ],
  },
  {
    id: 'cdp',
    label: 'CDP',
    icon: Database,
    summary: 'Gom dữ liệu khách từ nhiều nguồn để chia nhóm và phân tích.',
    steps: [
      {
        title: 'Dữ liệu hợp nhất',
        body: 'CDP nối hồ sơ khách rải rác ở nhiều kênh về một người duy nhất, dựa trên số điện thoại và định danh kênh.',
        to: '/cdp',
      },
      {
        title: 'Chia nhóm để chăm sóc',
        body: 'Tạo nhóm theo hành vi mua và mức chi tiêu, rồi dùng nhóm đó cho chiến dịch chăm sóc.',
      },
    ],
  },
  {
    id: 'dashboard',
    label: 'Tổng quan',
    icon: LayoutDashboard,
    summary: 'Số liệu trong ngày: hội thoại, đơn hàng, hiệu suất nhân viên.',
    steps: [
      {
        title: 'Đọc bảng số đầu ca',
        body: 'Nhìn số hội thoại chưa trả lời và đơn trong ngày để biết cần dồn sức vào đâu.',
        to: '/dashboard',
      },
    ],
  },
]
