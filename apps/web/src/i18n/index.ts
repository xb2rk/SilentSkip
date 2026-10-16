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
        phase: { label: "Giai đoạn", value: "Phase 1 · nền tảng + AI review" },
      },
      common: {
        loading: "Đang tải…",
      },
      overview: {
        title: "Tổng quan",
        description: "Trạng thái kết nối giữa web, API và cơ sở dữ liệu.",
        connection: "Kết nối hệ thống",
        version: "Phiên bản",
        apiVersion: "Phiên bản API",
        uptime: "Thời gian chạy",
        database: { label: "Cơ sở dữ liệu", ok: "Hoạt động", error: "Lỗi kết nối" },
        apiDown: "Không kết nối được API. Server backend đang chạy chứ?",
        roadmapHint: "Tính năng chọn dự án và so sánh A/B sẽ có từ giai đoạn E1; AI review từ E4.",
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
        description: "Cấu hình chung của ứng dụng và kết nối AI.",
        language: { label: "Ngôn ngữ", value: "Tiếng Việt" },
        themeNote: "Giao diện mặc định là tối; nút đổi giao diện ở góc phải trên.",
        ai: {
          title: "Kết nối AI (Insea)",
          description: "URL workflow và API key sẽ được cấu hình ở đây (E4).",
        },
        paths: {
          title: "Dự án được phép",
          description: "Danh sách thư mục gốc server được phép đọc (E1).",
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
