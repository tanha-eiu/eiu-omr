/**
 * =========================================================
 * Google Apps Script — backend lưu trữ cho Hệ thống chấm trắc nghiệm
 * =========================================================
 * CÁCH CÀI ĐẶT:
 * 1. Tạo 1 Google Sheet mới (trống, không cần tạo sẵn tab/cột gì).
 * 2. Vào menu Extensions > Apps Script.
 * 3. Xóa hết code mẫu, dán toàn bộ nội dung file này vào.
 * 4. Bấm Deploy > New deployment.
 *    - Type: chọn "Web app"
 *    - Execute as: Me
 *    - Who has access: Anyone
 * 5. Bấm Deploy, cấp quyền khi được hỏi (Authorize access).
 * 6. Copy URL dạng https://script.google.com/macros/s/xxx/exec
 *    -> dán vào ô "URL Web App Google Sheet" trong tab Quản lý mã đề của app.
 * 7. Mỗi khi sửa code này, phải bấm Deploy > Manage deployments >
 *    biểu tượng bút chì > chọn Version "New version" > Deploy lại
 *    thì thay đổi mới có hiệu lực (deploy cũ không tự cập nhật).
 * =========================================================
 */

function getOrCreateSheet_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------------------------------------------------------
// GET — đọc dữ liệu (?action=listMaDe hoặc ?action=listResults)
// ---------------------------------------------------------
function doGet(e) {
  const action = e.parameter.action;

  if (action === "listMaDe") {
    const sheet = getOrCreateSheet_("MaDe", ["MaDeId", "Ten", "DapAnJSON", "CapNhatLuc"]);
    const rows = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][0]) continue;
      list.push({
        id: rows[i][0],
        name: rows[i][1],
        answers: JSON.parse(rows[i][2] || "{}")
      });
    }
    return jsonResponse_({ ok: true, list: list });
  }

  if (action === "listResults") {
    const sheet = getOrCreateSheet_("KetQua", [
      "Timestamp", "CandidateNo", "HoTen", "MSSV", "De", "Diem", "DungTong", "ChiTietJSON"
    ]);
    const rows = sheet.getDataRange().getValues();
    const list = [];
    for (let i = 1; i < rows.length; i++) {
      if (!rows[i][1]) continue;
      list.push({
        timestamp: rows[i][0],
        candidateNo: rows[i][1],
        hoTen: rows[i][2],
        mssv: rows[i][3],
        de: rows[i][4],
        diem: rows[i][5],
        dungTong: rows[i][6],
        chiTiet: JSON.parse(rows[i][7] || "[]")
      });
    }
    return jsonResponse_({ ok: true, list: list });
  }

  return jsonResponse_({ ok: true, message: "OMR Sheet API đang hoạt động." });
}

// ---------------------------------------------------------
// POST — ghi dữ liệu (saveMaDe hoặc saveResultsBatch)
// ---------------------------------------------------------
function doPost(e) {
  const data = JSON.parse(e.postData.contents);

  if (data.action === "saveMaDe") {
    const sheet = getOrCreateSheet_("MaDe", ["MaDeId", "Ten", "DapAnJSON", "CapNhatLuc"]);
    const rows = sheet.getDataRange().getValues();
    let foundRow = -1;
    for (let i = 1; i < rows.length; i++) {
      if (rows[i][0] === data.maDe.id) { foundRow = i + 1; break; }
    }
    const rowValues = [
      data.maDe.id,
      data.maDe.name,
      JSON.stringify(data.maDe.answers),
      new Date()
    ];
    if (foundRow > 0) {
      sheet.getRange(foundRow, 1, 1, 4).setValues([rowValues]);
    } else {
      sheet.appendRow(rowValues);
    }
    return jsonResponse_({ ok: true });
  }

  if (data.action === "saveResultsBatch") {
    const sheet = getOrCreateSheet_("KetQua", [
      "Timestamp", "CandidateNo", "HoTen", "MSSV", "De", "Diem", "DungTong", "ChiTietJSON"
    ]);
    const now = new Date();
    const rowsToAdd = data.results.map(r => [
      now, r.candidateNo, r.hoTen || "", r.mssv || "", r.de || "",
      r.diem, r.dungTong, JSON.stringify(r.chiTiet || [])
    ]);
    if (rowsToAdd.length > 0) {
      sheet.getRange(sheet.getLastRow() + 1, 1, rowsToAdd.length, 8).setValues(rowsToAdd);
    }
    return jsonResponse_({ ok: true, count: rowsToAdd.length });
  }

  return jsonResponse_({ ok: false, error: "Không rõ action: " + data.action });
}
