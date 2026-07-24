// =========================================================
// Đồng bộ dữ liệu (mã đề, kết quả) với Google Sheet qua Apps Script Web App
// =========================================================
// URL Web App được khai báo trực tiếp trong js/config.js (biến SHEET_WEBAPP_URL).
//
// Lưu ý kỹ thuật: gọi fetch với body dạng string thường (KHÔNG set header
// Content-Type: application/json) để tránh trình duyệt gửi CORS preflight
// (OPTIONS) — Apps Script Web App không xử lý preflight, nếu để trình duyệt
// tự gửi sẽ bị lỗi. Apps Script vẫn đọc được JSON bình thường qua
// e.postData.contents dù Content-Type là text/plain.

const SheetsSync = {
  getUrl() {
    return (typeof SHEET_WEBAPP_URL === "string" ? SHEET_WEBAPP_URL.trim() : "");
  },
  isConfigured() {
    return !!this.getUrl();
  },

  async listMaDe() {
    const url = this.getUrl();
    if (!url) return null;
    const res = await fetch(url + "?action=listMaDe");
    const data = await res.json();
    return data.ok ? data.list : null;
  },

  async saveMaDe(maDe) {
    const url = this.getUrl();
    if (!url) return false;
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ action: "saveMaDe", maDe })
    });
    const data = await res.json();
    return !!data.ok;
  },

  async saveResultsBatch(results) {
    const url = this.getUrl();
    if (!url) return false;
    const res = await fetch(url, {
      method: "POST",
      body: JSON.stringify({ action: "saveResultsBatch", results })
    });
    const data = await res.json();
    return !!data.ok;
  },

  async listResults() {
    const url = this.getUrl();
    if (!url) return null;
    const res = await fetch(url + "?action=listResults");
    const data = await res.json();
    return data.ok ? data.list : null;
  }
};
