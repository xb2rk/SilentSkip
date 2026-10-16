import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * i18n setup. Vietnamese is the default (and currently only) product language.
 * Keys are semantic (`page.section.thing`) so additional locales can be added later
 * without touching components. Technical docs stay English by design.
 */
const resources = {
  vi: {
    translation: {
      app: {
        product: "Craftland QA",
        tagline: "Phòng QA cấu hình cho Designer",
        nav: {
          overview: "Tổng quan",
          compare: "So sánh A/B",
          whatIf: "What-If",
          history: "Lịch sử",
          tools: "Công cụ",
          settings: "Cài đặt",
        },
        theme: { label: "Chế độ hiển thị", system: "Theo hệ thống", light: "Sáng", dark: "Tối" },
        statusLink: "Trạng thái hệ thống",
        phase: { label: "Giai đoạn", value: "Phase 1 · nền tảng + AI review" },
      },
      common: {
        loading: "Đang tải…",
        refresh: "Làm mới",
        comingSoonAt: "Sắp có · {{phase}}",
      },
      overview: {
        title: "Tổng quan",
        description:
          "So sánh hai mốc A/B của dự án Craftland — đọc code, CSV và diff để chỉ ra cấu hình lệch nhau, kèm trích dẫn kiểm chứng được.",
        start: "Bắt đầu so sánh",
        ask: "Hỏi thêm (What-If)",
        steps: {
          title: "Cách hoạt động",
          one: {
            title: "1 · Thêm dự án",
            description: "Trỏ tới thư mục dự án Craftland; có thể thêm nhiều dự án.",
          },
          two: {
            title: "2 · Chọn A và B",
            description: "Chọn hai mốc (branch/commit) rồi chạy phân tích.",
          },
          three: {
            title: "3 · Đọc báo cáo",
            description: "Kết quả có trích dẫn nguồn; hỏi tiếp bằng What-If khi cần.",
          },
        },
        projects: {
          title: "Dự án",
          empty: "Chưa có dự án nào. Chức năng thêm dự án ra mắt ở bước xây dựng E1 kế tiếp.",
        },
        runs: {
          title: "Lần chạy gần đây",
          empty: "Chưa có lần phân tích nào. Kết quả sẽ được lưu và hiển thị ở đây.",
        },
      },
      status: {
        title: "Trạng thái hệ thống",
        description: "Chuỗi web → API → cơ sở dữ liệu, dùng để chẩn đoán khi có sự cố.",
        connection: "Kết nối hệ thống",
        version: "Phiên bản",
        apiVersion: "Phiên bản API",
        uptime: "Thời gian chạy",
        lastUpdated: "Cập nhật lúc",
        database: { label: "Cơ sở dữ liệu", ok: "Hoạt động", error: "Lỗi kết nối" },
        apiDown: "Không kết nối được API. Server backend đang chạy chứ?",
        note: "Trang này chỉ dành cho chẩn đoán — luồng công việc thường ngày bắt đầu từ Tổng quan.",
      },
      compare: {
        title: "So sánh A/B",
        description: "Chọn dự án và hai mốc (branch/commit) để phân tích khác biệt.",
        placeholder:
          "Màn hình này hoạt động từ giai đoạn E1 — sau khi có quản lý dự án và git refs.",
      },
      whatIf: {
        title: "What-If Studio",
        description: "Hỏi tiếp về báo cáo và các thay đổi cấu hình, có trích dẫn bằng chứng.",
        placeholder: "Sẽ hoạt động từ giai đoạn E6 — sau khi có báo cáo AI (E4) và bộ nhớ phiên.",
      },
      history: {
        title: "Lịch sử",
        description: "Các lần phân tích đã chạy, mở lại báo cáo và so sánh hai lần chạy.",
        placeholder: "Sẽ hoạt động từ giai đoạn E1/E5 — khi các lần chạy bắt đầu được lưu lại.",
      },
      tools: {
        title: "Công cụ",
        description: "Các tiện ích bổ trợ ngoài luồng so sánh.",
        writer: {
          title: "Trình tạo mã",
          description: "Sinh enum/index từ CSV cho contract của dự án.",
        },
        localization: {
          title: "Kiểm tra bản địa hoá",
          description: "So khớp key.csv với các cột *Key trong bảng cấu hình.",
        },
        placeholder: "Sẽ ra mắt ở giai đoạn E9.",
      },
      settings: {
        title: "Cài đặt",
        description: "Tuỳ chỉnh giao diện và cấu hình kết nối của ứng dụng.",
        appearance: {
          title: "Giao diện",
          description: "Chế độ hiển thị áp dụng ngay và được ghi nhớ cho lần mở sau.",
        },
        language: {
          label: "Ngôn ngữ",
          value: "Tiếng Việt",
          note: "Các ngôn ngữ khác sẽ được thêm qua i18n khi cần.",
        },
        diagnostics: {
          title: "Chẩn đoán",
          description: "Kiểm tra kết nối web → API → cơ sở dữ liệu.",
          open: "Xem trạng thái hệ thống",
        },
        ai: {
          title: "Kết nối AI (Insea)",
          description: "URL workflow, API key và nút kiểm tra kết nối.",
        },
        paths: {
          title: "Dự án được phép",
          description: "Danh sách thư mục gốc server được phép đọc.",
        },
        editorGen: {
          title: "Chỉ mục editorGen",
          description: "Đọc thêm Temp/UGCLanguage/editorGen khi phân tích (mặc định tắt).",
        },
      },
      notFound: { description: "Trang bạn tìm không tồn tại.", back: "Về trang Tổng quan" },
    },
  },
};

void i18n.use(initReactI18next).init({
  resources,
  lng: "vi",
  fallbackLng: "vi",
  interpolation: { escapeValue: false },
});

export default i18n;
