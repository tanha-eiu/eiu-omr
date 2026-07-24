// =========================================================
// Đọc/ghi file Excel bằng SheetJS
// =========================================================

// Chuẩn hóa số báo danh để SO KHỚP: ép về số nguyên rồi chuyển lại chuỗi.
// Cách này loại bỏ mọi số 0 ở đầu một cách nhất quán, không phụ thuộc
// cách viết ("10", "010", "0010" đều chuẩn hóa thành "10").
function normalizeCandidateNo(v) {
  const s = String(v ?? "").trim();
  if (!s) return "";
  if (/^\d+$/.test(s)) return String(parseInt(s, 10));
  return s; // không phải toàn chữ số (vd "(không đọc được)") -> giữ nguyên
}

// Định dạng số báo danh để HIỂN THỊ: tối thiểu 2 chữ số (1 -> "01", 14 -> "14").
// Chỉ dùng cho hiển thị (bảng kết quả, Excel), KHÔNG dùng để so khớp.
function formatCandidateNoDisplay(v) {
  const normalized = normalizeCandidateNo(v);
  if (!/^\d+$/.test(normalized)) return v ?? "";
  return normalized.padStart(2, "0");
}

// Chuẩn hóa tên cột để so khớp linh hoạt: bỏ khoảng trắng, dấu chấm, viết thường.
// Nhờ vậy "Candidate No.", "candidate no", "Candidate No", "SBD", "Số báo danh"
// đều được nhận diện, thay vì phải khớp chính xác từng ký tự.
function normalizeHeader(h) {
  return String(h).trim().toLowerCase().replace(/[.\s]+/g, "");
}

// Tìm giá trị cột trong 1 dòng dữ liệu, dựa trên danh sách các tên cột chấp nhận được
function findColumnValue(row, acceptedNames) {
  const accepted = acceptedNames.map(normalizeHeader);
  for (const key of Object.keys(row)) {
    if (accepted.includes(normalizeHeader(key))) return row[key];
  }
  return undefined;
}

// Đọc file danh sách sinh viên: cần các cột STT, Họ và tên, MSSV, Candidate No.
// Trả về mảng [{stt, hoTen, mssv, candidateNo}], candidateNo được chuẩn hóa về dạng chuỗi số
// (bỏ số 0 ở đầu để so khớp với kết quả đọc từ phiếu, vì phiếu bỏ cột trống)
async function readStudentList(file) {
  await XlsxLib.load();
  const buf = await file.arrayBuffer();
  const wb = window["XLSX"].read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  const rows = window["XLSX"].utils.sheet_to_json(sheet, { defval: "" });

  if (rows.length > 0) {
    const headers = Object.keys(rows[0]);
    const candidateVal = findColumnValue(rows[0], ["Candidate No.", "Candidate No", "candidateNo", "SBD", "Số báo danh"]);
    if (candidateVal === undefined) {
      console.warn("Không tìm thấy cột Candidate No. trong file Excel. Các cột hiện có:", headers);
    }
  }

  return rows.map(r => {
    const stt = findColumnValue(r, ["STT"]) ?? "";
    const hoTen = findColumnValue(r, ["Họ và tên", "Họ tên", "hoTen"]) ?? "";
    const mssv = String(findColumnValue(r, ["MSSV"]) ?? "").trim();
    const rawCandidate = String(findColumnValue(r, ["Candidate No.", "Candidate No", "candidateNo", "SBD", "Số báo danh"]) ?? "").trim();
    const candidateNo = normalizeCandidateNo(rawCandidate);
    return { stt, hoTen, mssv, candidateNo };
  });
}

// Tìm sinh viên theo candidateNo đọc được từ phiếu (cả 2 phía đã được chuẩn hóa).
function matchStudent(studentList, candidateNoFromSheet) {
  if (!candidateNoFromSheet) return null;
  const normalized = normalizeCandidateNo(candidateNoFromSheet);
  return studentList.find(s => s.candidateNo === normalized) || null;
}

// Xuất file Excel kết quả: Candidate No., Họ và tên, MSSV, Đề, Điểm, Đúng/Tổng, Câu sai
async function exportResultsToExcel(results, fileName) {
  await XlsxLib.load();

  const data = results.map(r => ({
    "Candidate No.": formatCandidateNoDisplay(r.candidateNo),
    "Họ và tên": r.hoTen ?? "",
    "MSSV": r.unmatched ? "CHƯA KHỚP - kiểm tra tay" : (r.mssv ?? ""),
    "Đề": r.de ?? "",
    "Điểm": r.diem ?? "",
    "Đúng/Tổng": r.dungTong ?? "",
    "Câu sai": (r.cauSai || []).join(", ")
  }));

  const ws = window["XLSX"].utils.json_to_sheet(data);
  ws["!cols"] = [
    { wch: 12 }, { wch: 26 }, { wch: 20 }, { wch: 8 }, { wch: 8 }, { wch: 12 }, { wch: 40 }
  ];

  const wb = window["XLSX"].utils.book_new();
  window["XLSX"].utils.book_append_sheet(wb, ws, "Kết quả");
  window["XLSX"].writeFile(wb, fileName || "ket_qua_cham_thi.xlsx");
}
