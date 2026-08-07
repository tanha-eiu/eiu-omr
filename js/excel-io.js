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

// Đọc file danh sách sinh viên. Hỗ trợ 2 kiểu file:
//  1) File đơn giản: có sẵn cột "Candidate No.", "Họ và tên", "MSSV" ngay dòng đầu.
//  2) File phòng đào tạo cấp: có vài dòng tiêu đề trường/môn học phía trên trước khi
//     tới dòng tiêu đề bảng thật (Stt, Mã SV, Họ lót, Tên, ...) — khi đó dùng cột
//     "Stt" làm Candidate No., và ghép "Họ lót" + " " + "Tên" thành Họ và tên.
// Trả về mảng [{stt, hoTen, mssv, candidateNo}].
async function readStudentList(file) {
  await XlsxLib.load();
  const buf = await file.arrayBuffer();
  const wb = window["XLSX"].read(buf, { type: "array" });
  const sheet = wb.Sheets[wb.SheetNames[0]];
  // Đọc dạng mảng-các-mảng (không giả định dòng 1 là tiêu đề) để tự dò đúng
  // dòng tiêu đề bảng, vì file phòng đào tạo có vài dòng thông tin trường/môn ở trên.
  const rows = window["XLSX"].utils.sheet_to_json(sheet, { header: 1, defval: "" });

  const HEADER_MARKERS = ["stt", "candidateno", "sbd", "sobaodanh"];
  let headerRowIdx = -1;
  let headerMap = {}; // tên cột đã chuẩn hóa -> chỉ số cột

  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    const map = {};
    row.forEach((cell, c) => { if (cell !== "" && cell !== undefined) map[normalizeHeader(cell)] = c; });
    if (HEADER_MARKERS.some(m => map[m] !== undefined)) {
      headerRowIdx = r;
      headerMap = map;
      break;
    }
  }

  if (headerRowIdx === -1) return []; // không tìm thấy dòng tiêu đề hợp lệ nào

  const getCell = (row, ...names) => {
    for (const n of names) {
      const idx = headerMap[normalizeHeader(n)];
      if (idx !== undefined && row[idx] !== undefined && row[idx] !== "") return row[idx];
    }
    return undefined;
  };

  const list = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row || row.every(c => c === "" || c === undefined)) continue;

    const explicitCandidate = getCell(row, "Candidate No.", "Candidate No", "SBD", "Số báo danh");
    const stt = getCell(row, "STT", "Stt");
    const candidateSource = explicitCandidate !== undefined ? explicitCandidate : stt;
    if (candidateSource === undefined) continue; // dòng không có Stt/Candidate No. -> bỏ qua (hết bảng)

    const explicitHoTen = getCell(row, "Họ và tên", "Họ tên");
    const hoLot = getCell(row, "Họ lót");
    const ten = getCell(row, "Tên");
    const hoTen = explicitHoTen !== undefined
      ? String(explicitHoTen).trim()
      : [hoLot, ten].filter(v => v !== undefined).map(v => String(v).trim()).join(" ");

    const mssv = String(getCell(row, "MSSV", "Mã SV") ?? "").trim();

    list.push({
      stt: String(stt !== undefined ? stt : candidateSource).trim(),
      hoTen,
      mssv,
      candidateNo: normalizeCandidateNo(candidateSource)
    });
  }
  return list;
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
