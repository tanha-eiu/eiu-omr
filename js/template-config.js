// =========================================================
// Tọa độ chuẩn của phiếu trả lời trắc nghiệm EIU
// Đo trực tiếp từ file mẫu (template.pdf) ở độ phân giải 200dpi.
// Mọi ảnh scan đầu vào, dù nghiêng/lệch, đều được warp (căn chỉnh
// phối cảnh) về đúng khung REF_WIDTH x REF_HEIGHT này dựa trên
// 4 marker góc, nên tọa độ bubble bên dưới luôn cố định.
// =========================================================

const TEMPLATE = {
  refWidth: 1654,
  refHeight: 2338,

  // Tâm 4 marker góc (dấu hình chữ nhật nhỏ màu đen) trên phiếu mẫu.
  // Thứ tự: trên-trái, trên-phải, dưới-phải, dưới-trái (thuận chiều kim đồng hồ)
  markers: {
    tl: { x: 94,   y: 109.5 },
    tr: { x: 1535, y: 104 },
    br: { x: 1540.5, y: 2189.5 },
    bl: { x: 102,  y: 2192 }
  },

  bubbleRadius: 15,

  // Ô "Candidate No." — 4 cột chữ số, mỗi cột 10 bubble (0-9)
  candidateNo: {
    numDigits: 4,
    numOptions: 10,
    colX: [1172.9, 1226.6, 1278.6, 1333.7],
    rowY0: 358,       // tâm bubble số "0" theo trục y (đã xác minh bằng OCR trực tiếp)
    rowStep: 42.67     // khoảng cách giữa các hàng số
  },

  // Khối 20 câu trắc nghiệm (chỉ dùng cột đầu tiên của phiếu gốc 60 câu)
  questions: {
    count: 20,
    options: ["A", "B", "C", "D", "E"],
    colX: { A: 236, B: 294, C: 352, D: 410, E: 470 },
    rowY: [
      885, 940, 994, 1048, 1102,
      1203, 1257, 1311, 1365, 1420,
      1519, 1573, 1627, 1681, 1735,
      1834, 1888, 1943, 1996, 2050
    ]
  }
};
