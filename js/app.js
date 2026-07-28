// =========================================================
// Hệ thống chấm trắc nghiệm — app.js
// =========================================================

const SO_CAU = TEMPLATE.questions.count; // 20
const DAP_AN_HOP_LE = TEMPLATE.questions.options; // ["A","B","C","D","E"]

const state = {
  maDeList: [],
  editingMaDeId: null,

  pendingStudentFile: null,
  studentList: [],            // danh sách lớp (nếu đã tải), dùng để tra tên + hiện dòng chờ chấm

  // Kết quả đã chấm, dạng map: key -> entry
  // key = candidateNo đã chuẩn hóa, hoặc "blank_<n>" nếu phiếu không đọc được candidateNo
  gradedResults: {},

  pendingConflicts: [],       // hàng đợi xử lý trùng candidateNo khi chấm điểm
  pendingFinish: null,        // {maDe, committed:[]} chờ chấm xong toàn bộ conflict rồi mới hoàn tất

  pageCanvases: [],
  sheetCache: [],
  currentIndex: -1,

  currentAnswers: {},
  reviewFlags: {},
  candidateNo: null,
  candidateColumns: [],
  candidateReview: false,
  warpedGrayMat: null,

  manualCorners: null,
  zoom: 1
};

// ============================================================
// 1. CHUYỂN TAB
// ============================================================
function initTabs() {
  const navItems = document.querySelectorAll(".nav-item");
  navItems.forEach(item => {
    item.addEventListener("click", () => {
      navItems.forEach(i => i.classList.remove("active"));
      item.classList.add("active");
      document.querySelectorAll(".tab-content").forEach(t => t.classList.remove("active"));
      document.getElementById("tab-" + item.dataset.tab).classList.add("active");
    });
  });
}

// ============================================================
// 2. QUẢN LÝ MÃ ĐỀ — bảng nhập đáp án kiểu Excel
// ============================================================

function renderMaDeAnswerGrid(existingAnswers) {
  const grid = document.getElementById("maDeAnswerGrid");
  grid.innerHTML = "";
  for (let q = 1; q <= SO_CAU; q++) {
    const cell = document.createElement("div");
    cell.className = "ma-de-cell";
    const label = document.createElement("span");
    label.className = "q-label";
    label.textContent = "Câu " + q;
    const select = document.createElement("select");
    select.dataset.question = q;
    const blankOpt = document.createElement("option");
    blankOpt.value = "";
    blankOpt.textContent = "--";
    select.appendChild(blankOpt);
    DAP_AN_HOP_LE.forEach(opt => {
      const o = document.createElement("option");
      o.value = opt;
      o.textContent = opt;
      select.appendChild(o);
    });
    if (existingAnswers && existingAnswers[q]) select.value = existingAnswers[q];
    select.addEventListener("change", () => {
      cell.classList.toggle("empty", !select.value);
    });
    cell.classList.toggle("empty", !select.value);
    cell.appendChild(label);
    cell.appendChild(select);
    grid.appendChild(cell);
  }
}

function readMaDeAnswerGrid() {
  const selects = document.querySelectorAll("#maDeAnswerGrid select");
  const answers = {};
  const missing = [];
  selects.forEach(sel => {
    const q = parseInt(sel.dataset.question, 10);
    if (sel.value) answers[q] = sel.value;
    else missing.push(q);
  });
  if (missing.length > 0) {
    return { ok: false, error: `Còn thiếu đáp án câu: ${missing.join(", ")}` };
  }
  return { ok: true, answers };
}

function renderMaDeList() {
  const listEl = document.getElementById("maDeList");
  document.getElementById("maDeCountLabel").textContent = `${state.maDeList.length} mã đề đã lưu`;
  listEl.innerHTML = "";
  state.maDeList.forEach(md => {
    const soCauDaNhap = Object.keys(md.answers || {}).length;
    const item = document.createElement("div");
    item.className = "ma-de-item" + (soCauDaNhap < SO_CAU ? " incomplete" : "");
    if (md.id === state.editingMaDeId) item.classList.add("editing");
    item.innerHTML = `
      <span class="ma-de-name">${md.name}</span>
      <span class="ma-de-status">${soCauDaNhap}/${SO_CAU} câu${soCauDaNhap < SO_CAU ? " - chưa đủ" : ""}</span>
    `;
    item.addEventListener("click", () => openMaDeEditor(md.id));
    listEl.appendChild(item);
  });
  refreshMaDeSelect();
}

function refreshMaDeSelect() {
  const sel = document.getElementById("selectMaDe");
  const current = sel.value;
  sel.innerHTML = "";
  state.maDeList.forEach(md => {
    const opt = document.createElement("option");
    opt.value = md.id;
    opt.textContent = md.name;
    sel.appendChild(opt);
  });
  if (current) sel.value = current;
}

function openMaDeEditor(id) {
  state.editingMaDeId = id;
  document.getElementById("maDeEditor").hidden = false;
  if (id) {
    const md = state.maDeList.find(m => m.id === id);
    document.getElementById("maDeName").value = md.name;
    renderMaDeAnswerGrid(md.answers);
  } else {
    document.getElementById("maDeName").value = "";
    renderMaDeAnswerGrid(null);
  }
  document.getElementById("maDeValidateMsg").textContent = "";
  renderMaDeList();
}

function closeMaDeEditor() {
  state.editingMaDeId = null;
  document.getElementById("maDeEditor").hidden = true;
  renderMaDeList();
}

async function saveMaDe() {
  const name = document.getElementById("maDeName").value.trim();
  const msgEl = document.getElementById("maDeValidateMsg");
  if (!name) { msgEl.textContent = "Vui lòng nhập tên mã đề."; msgEl.className = "validate-msg error"; return; }

  const parsed = readMaDeAnswerGrid();
  if (!parsed.ok) { msgEl.textContent = parsed.error; msgEl.className = "validate-msg error"; return; }

  let maDeObj;
  if (state.editingMaDeId) {
    maDeObj = state.maDeList.find(m => m.id === state.editingMaDeId);
    maDeObj.name = name; maDeObj.answers = parsed.answers;
  } else {
    maDeObj = { id: "made_" + Date.now(), name, answers: parsed.answers };
    state.maDeList.push(maDeObj);
  }
  persistMaDeList();

  if (SheetsSync.isConfigured()) {
    msgEl.textContent = "Đang đồng bộ lên Google Sheet...";
    msgEl.className = "validate-msg";
    const synced = await SheetsSync.saveMaDe(maDeObj);
    msgEl.textContent = synced
      ? "Hợp lệ, đủ " + SO_CAU + " câu. Đã đồng bộ Google Sheet."
      : "Đã lưu tại máy, nhưng đồng bộ Google Sheet thất bại (kiểm tra URL/mạng).";
    msgEl.className = synced ? "validate-msg ok" : "validate-msg error";
  } else {
    msgEl.textContent = "Hợp lệ, đủ " + SO_CAU + " câu. (Chưa cấu hình Google Sheet nên chỉ lưu tại máy.)";
    msgEl.className = "validate-msg ok";
  }
  closeMaDeEditor();
}

function persistMaDeList() {
  localStorage.setItem("omr_ma_de_list", JSON.stringify(state.maDeList));
}
function loadMaDeList() {
  const raw = localStorage.getItem("omr_ma_de_list");
  state.maDeList = raw ? JSON.parse(raw) : [];
}

async function syncMaDeListFromSheet() {
  if (!SheetsSync.isConfigured()) {
    document.getElementById("sheetSyncStatus").textContent = "chưa cấu hình (sửa js/config.js)";
    return;
  }
  const statusEl = document.getElementById("sheetSyncStatus");
  statusEl.textContent = "đang tải mã đề từ Google Sheet...";
  try {
    const remoteList = await SheetsSync.listMaDe();
    if (remoteList) {
      state.maDeList = remoteList;
      persistMaDeList();
      renderMaDeList();
      statusEl.textContent = `đã kết nối — ${remoteList.length} mã đề trên Google Sheet`;
    } else {
      statusEl.textContent = "không đọc được dữ liệu từ Google Sheet";
    }
  } catch (err) {
    statusEl.textContent = "lỗi kết nối Google Sheet (dùng dữ liệu lưu tại máy)";
  }
}

// ============================================================
// 3. DANH SÁCH SINH VIÊN — có thể tải trước hoặc sau khi đã chấm
// ============================================================

function handleStudentListFileSelected(file) {
  state.pendingStudentFile = file;
  document.getElementById("studentListFileName").textContent = file ? file.name : "chưa chọn file";
}

async function uploadStudentList() {
  if (!state.pendingStudentFile) {
    alert("Chưa chọn file danh sách sinh viên.");
    return;
  }
  const statusEl = document.getElementById("studentListFileName");
  const originalName = state.pendingStudentFile.name;
  statusEl.textContent = "đang đọc...";
  try {
    const list = await readStudentList(state.pendingStudentFile);
    const missingCandidateNo = list.filter(s => !s.candidateNo).length;
    if (missingCandidateNo === list.length && list.length > 0) {
      statusEl.textContent = originalName + " — lỗi: không thấy cột Candidate No.";
      alert("Không tìm thấy cột \"Candidate No.\" trong file Excel.\nKiểm tra lại tên cột (chấp nhận: Candidate No., Candidate No, SBD, Số báo danh).");
      return;
    }

    state.studentList = list;

    // Đối chiếu ngược: các bài đã chấm trước đó (chưa có tên) mà khớp candidateNo
    // trong danh sách mới -> tự động điền tên, trừ khi đã được sửa tay thủ công.
    let matchedCount = 0;
    Object.values(state.gradedResults).forEach(entry => {
      if (entry.manualOverride) return;
      const student = list.find(s => s.candidateNo === normalizeCandidateNo(entry.candidateNo));
      if (student) {
        entry.hoTen = student.hoTen;
        entry.mssv = student.mssv;
        entry.matched = true;
        matchedCount++;
      }
    });

    statusEl.textContent = `${originalName} — đã tải ${list.length} sinh viên` +
      (matchedCount > 0 ? `, đối chiếu được ${matchedCount} bài đã chấm trước đó` : "");
    renderResultTable();
  } catch (err) {
    statusEl.textContent = originalName + " — lỗi đọc file";
    alert("Không đọc được file danh sách: " + err.message);
  }
}

// ============================================================
// 4. TẢI PDF + XỬ LÝ OMR TỪNG PHIẾU (có cache theo trang)
// ============================================================

async function handlePdfUpload(file) {
  const progressLabel = document.getElementById("progressLabel");
  progressLabel.textContent = "Đang tách trang PDF...";
  try {
    await CvLib.load();
    state.pageCanvases = await renderPdfToCanvases(file);
    state.sheetCache = new Array(state.pageCanvases.length).fill(null);
    state.currentIndex = 0;
    await loadCurrentSheet();
    updatePendingCountLabel();
  } catch (err) {
    progressLabel.textContent = "Lỗi xử lý PDF";
    alert("Không xử lý được file PDF: " + err.message);
  }
}

async function loadCurrentSheet() {
  const total = state.pageCanvases.length;
  const idx = state.currentIndex;
  document.getElementById("progressLabel").textContent = `Phiếu ${idx + 1} / ${total}`;
  document.getElementById("btnPrevSheet").disabled = idx <= 0;
  document.getElementById("btnNextSheet").disabled = idx >= total - 1;

  if (state.warpedGrayMat) { state.warpedGrayMat.delete(); state.warpedGrayMat = null; }
  state.manualCorners = null;

  const canvas = state.pageCanvases[idx];
  const cache = state.sheetCache[idx];

  if (cache && cache.processed) {
    const result = processSheet(canvas, cache.corners);
    if (!result.ok) { showManualCornerUI(canvas); return; }
    hideManualCornerUI();
    state.warpedGrayMat = result.warpedGray;
    state.candidateNo = cache.candidateNo;
    state.candidateColumns = cache.candidateColumns;
    state.currentAnswers = { ...cache.currentAnswers };
    state.reviewFlags = { ...cache.reviewFlags };
    applyOmrDebugLabel(result.fillThreshold);
    drawSheetCanvas();
    renderCandidateCard();
    renderAnswerGrid();
    return;
  }

  const result = processSheet(canvas);
  if (!result.ok) { showManualCornerUI(canvas); return; }
  finalizeNewSheetResult(canvas, result);
}

function applyOmrDebugLabel(fillThreshold) {
  const el = document.getElementById("debugThresholdLabel");
  if (el) el.textContent = fillThreshold !== undefined ? `(ngưỡng tô: ${Math.round(fillThreshold)})` : "";
}

function finalizeNewSheetResult(rawCanvas, result) {
  hideManualCornerUI();
  state.warpedGrayMat = result.warpedGray;
  state.candidateNo = result.candidateResult.candidateNo;
  state.candidateColumns = result.candidateResult.columns;
  state.currentAnswers = { ...result.answerResult.answers };
  state.reviewFlags = { ...result.answerResult.reviewFlags };
  applyOmrDebugLabel(result.fillThreshold);

  state.sheetCache[state.currentIndex] = {
    processed: true,
    corners: result.corners,
    candidateNo: state.candidateNo,
    candidateColumns: state.candidateColumns,
    currentAnswers: { ...state.currentAnswers },
    reviewFlags: { ...state.reviewFlags },
    confirmed: false,
    graded: false
  };

  drawSheetCanvas();
  renderCandidateCard();
  renderAnswerGrid();
}

function syncCurrentIntoCache() {
  const cache = state.sheetCache[state.currentIndex];
  if (!cache) return;
  cache.currentAnswers = { ...state.currentAnswers };
  cache.reviewFlags = { ...state.reviewFlags };
  cache.candidateColumns = state.candidateColumns;
  cache.candidateNo = state.candidateNo;
}

// ---- Chỉnh góc thủ công (chỉ hiện khi auto-detect marker thất bại thật sự) ----

function showManualCornerUI(rawCanvas, startingCorners) {
  document.getElementById("manualCornerBanner").hidden = false;
  document.getElementById("btnAlignManual").hidden = false;
  document.getElementById("cornerHandles").hidden = false;

  const canvasEl = document.getElementById("sheetCanvas");
  canvasEl.width = rawCanvas.width;
  canvasEl.height = rawCanvas.height;
  canvasEl.getContext("2d").drawImage(rawCanvas, 0, 0);
  canvasEl.style.transform = "";

  if (startingCorners) {
    state.manualCorners = {
      tl: { ...startingCorners.tl }, tr: { ...startingCorners.tr },
      br: { ...startingCorners.br }, bl: { ...startingCorners.bl }
    };
  } else {
    const w = rawCanvas.width, h = rawCanvas.height;
    state.manualCorners = {
      tl: { x: 0.06 * w, y: 0.05 * h },
      tr: { x: 0.94 * w, y: 0.05 * h },
      br: { x: 0.94 * w, y: 0.95 * h },
      bl: { x: 0.06 * w, y: 0.95 * h }
    };
  }
  positionCornerHandles();
  initCornerHandleDrag();
}

// Vào chế độ chỉnh tay marker NGAY CẢ KHI auto-detect "thành công" nhưng bị lệch —
// dùng chính tọa độ auto-detect làm điểm khởi đầu, chỉ cần kéo sửa điểm sai.
function enterManualCorrectionMode() {
  const idx = state.currentIndex;
  const rawCanvas = state.pageCanvases[idx];
  const cache = state.sheetCache[idx];
  if (!rawCanvas) { alert("Chưa có phiếu để chỉnh."); return; }
  showManualCornerUI(rawCanvas, cache ? cache.corners : null);
}

function hideManualCornerUI() {
  document.getElementById("manualCornerBanner").hidden = true;
  document.getElementById("btnAlignManual").hidden = true;
  document.getElementById("cornerHandles").hidden = true;
}

function positionCornerHandles() {
  const canvasEl = document.getElementById("sheetCanvas");
  const scaleX = canvasEl.clientWidth / canvasEl.width;
  const scaleY = canvasEl.clientHeight / canvasEl.height;
  document.querySelectorAll(".corner-handle").forEach(handle => {
    const key = handle.dataset.corner;
    const p = state.manualCorners[key];
    handle.style.left = (p.x * scaleX) + "px";
    handle.style.top = (p.y * scaleY) + "px";
  });
}

function initCornerHandleDrag() {
  const canvasEl = document.getElementById("sheetCanvas");
  document.querySelectorAll(".corner-handle").forEach(handle => {
    handle.onmousedown = e => {
      e.preventDefault();
      const key = handle.dataset.corner;
      function onMove(ev) {
        const rect = canvasEl.getBoundingClientRect();
        const scaleX = canvasEl.width / canvasEl.clientWidth;
        const scaleY = canvasEl.height / canvasEl.clientHeight;
        const x = (ev.clientX - rect.left) * scaleX;
        const y = (ev.clientY - rect.top) * scaleY;
        state.manualCorners[key] = { x, y };
        positionCornerHandles();
      }
      function onUp() {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      }
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    };
  });
}

function alignManually() {
  const canvas = state.pageCanvases[state.currentIndex];
  const result = processSheet(canvas, state.manualCorners);
  if (!result.ok) {
    alert("Không căn chỉnh được, thử kéo lại 4 chấm cho sát marker hơn.");
    return;
  }
  finalizeNewSheetResult(canvas, result);
}

// ============================================================
// 5. VẼ PREVIEW + OVERLAY LÊN CANVAS
// ============================================================

function drawSheetCanvas() {
  const canvasEl = document.getElementById("sheetCanvas");
  canvasEl.width = TEMPLATE.refWidth;
  canvasEl.height = TEMPLATE.refHeight;
  const ctx = canvasEl.getContext("2d");

  const displayCanvas = grayMatToCanvas(state.warpedGrayMat);
  ctx.drawImage(displayCanvas, 0, 0);

  drawOverlay(ctx);
  canvasEl.style.transform = `scale(${state.zoom})`;
  canvasEl.style.transformOrigin = "top left";
  canvasEl.onclick = onSheetCanvasClick;
}

function drawOverlay(ctx) {
  const qcfg = TEMPLATE.questions;
  const r = TEMPLATE.bubbleRadius;

  for (let qi = 0; qi < qcfg.count; qi++) {
    const q = qi + 1;
    const cy = qcfg.rowY[qi];
    const ans = state.currentAnswers[q];

    if (state.reviewFlags[q]) {
      ctx.strokeStyle = "#E24B4A";
      ctx.lineWidth = 3;
      ctx.strokeRect(qcfg.colX.A - r - 10, cy - r - 8, (qcfg.colX.E - qcfg.colX.A) + 2 * r + 20, 2 * r + 16);
    }
    if (ans) {
      ctx.beginPath();
      ctx.arc(qcfg.colX[ans], cy, r, 0, Math.PI * 2);
      ctx.fillStyle = "rgba(20,136,216,0.55)";
      ctx.fill();
      ctx.strokeStyle = "#1488D8";
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  const ccfg = TEMPLATE.candidateNo;
  state.candidateColumns.forEach((col, c) => {
    if (col.blank) return;
    const cx = ccfg.colX[c];
    const cy = ccfg.rowY0 + ccfg.rowStep * col.digit;
    if (col.review) {
      ctx.strokeStyle = "#E24B4A";
      ctx.lineWidth = 3;
      ctx.strokeRect(cx - r - 6, ccfg.rowY0 - r - 6, 2 * r + 12, ccfg.rowStep * 9 + 2 * r + 12);
    }
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(20,136,216,0.55)";
    ctx.fill();
    ctx.strokeStyle = "#1488D8";
    ctx.lineWidth = 2;
    ctx.stroke();
  });
}

function onSheetCanvasClick(e) {
  const canvasEl = e.target;
  const rect = canvasEl.getBoundingClientRect();
  const scaleX = canvasEl.width / rect.width;
  const scaleY = canvasEl.height / rect.height;
  const px = (e.clientX - rect.left) * scaleX;
  const py = (e.clientY - rect.top) * scaleY;

  const hitQuestion = findNearestQuestionBubble(px, py);
  if (hitQuestion) {
    const { q, opt } = hitQuestion;
    state.currentAnswers[q] = (state.currentAnswers[q] === opt) ? null : opt;
    state.reviewFlags[q] = false;
    syncCurrentIntoCache();
    drawSheetCanvas();
    renderAnswerGrid();
    return;
  }

  const hitCandidate = findNearestCandidateBubble(px, py);
  if (hitCandidate) {
    const { col, digit } = hitCandidate;
    const current = state.candidateColumns[col];
    if (!current.blank && current.digit === digit) {
      state.candidateColumns[col] = { digit: null, review: false, blank: true };
    } else {
      state.candidateColumns[col] = { digit, review: false, blank: false };
    }
    recomputeCandidateNo();
    syncCurrentIntoCache();
    drawSheetCanvas();
    renderCandidateCard();
  }
}

function findNearestQuestionBubble(px, py) {
  const qcfg = TEMPLATE.questions;
  const hitRadius = TEMPLATE.bubbleRadius * 1.6;
  for (let qi = 0; qi < qcfg.count; qi++) {
    const cy = qcfg.rowY[qi];
    if (Math.abs(py - cy) > hitRadius) continue;
    for (const opt of qcfg.options) {
      const cx = qcfg.colX[opt];
      if (Math.hypot(px - cx, py - cy) <= hitRadius) return { q: qi + 1, opt };
    }
  }
  return null;
}

function findNearestCandidateBubble(px, py) {
  const ccfg = TEMPLATE.candidateNo;
  const hitRadius = TEMPLATE.bubbleRadius * 1.6;
  for (let c = 0; c < ccfg.numDigits; c++) {
    const cx = ccfg.colX[c];
    if (Math.abs(px - cx) > hitRadius) continue;
    for (let d = 0; d < ccfg.numOptions; d++) {
      const cy = ccfg.rowY0 + ccfg.rowStep * d;
      if (Math.hypot(px - cx, py - cy) <= hitRadius) return { col: c, digit: d };
    }
  }
  return null;
}

function recomputeCandidateNo() {
  const nonBlank = state.candidateColumns.filter(c => !c.blank);
  state.candidateNo = nonBlank.length > 0 ? nonBlank.map(c => c.digit).join("") : null;
  state.candidateReview = nonBlank.length === 0 || nonBlank.some(c => c.review);
}

// ============================================================
// 6. THẺ SỐ BÁO DANH + LƯỚI ĐÁP ÁN (panel bên phải)
// ============================================================

function renderCandidateCard() {
  const valueEl = document.getElementById("candidateNoValue");
  const nameEl = document.getElementById("candidateNoName");
  valueEl.textContent = state.candidateNo !== null ? "Candidate No. " + state.candidateNo : "—";

  const student = matchStudent(state.studentList, state.candidateNo);
  nameEl.textContent = student ? `${student.hoTen} (${student.mssv})` : "Chưa xác định sinh viên";
}

function renderAnswerGrid() {
  const grid = document.getElementById("answerGrid");
  grid.innerHTML = "";
  for (let q = 1; q <= SO_CAU; q++) {
    const ans = state.currentAnswers[q];
    const needReview = !!state.reviewFlags[q];
    const cell = document.createElement("div");
    cell.className = "answer-cell";
    if (needReview) cell.classList.add("review");
    else if (ans) cell.classList.add("filled");
    else cell.classList.add("blank");
    cell.textContent = `${q} ${ans || "-"}`;
    cell.addEventListener("click", () => cycleAnswer(q));
    grid.appendChild(cell);
  }
  updateWarningBanner();
}

function cycleAnswer(q) {
  const order = [null, ...DAP_AN_HOP_LE];
  const idx = order.indexOf(state.currentAnswers[q] || null);
  state.currentAnswers[q] = order[(idx + 1) % order.length];
  state.reviewFlags[q] = false;
  syncCurrentIntoCache();
  renderAnswerGrid();
  if (state.warpedGrayMat) drawSheetCanvas();
}

function updateWarningBanner() {
  const banner = document.getElementById("warningBanner");
  const textEl = document.getElementById("warningText");
  const flagged = Object.keys(state.reviewFlags).filter(q => state.reviewFlags[q]);
  if (flagged.length > 0) {
    banner.hidden = false;
    textEl.textContent = `Câu ${flagged.join(", ")}: cần kiểm tra lại`;
  } else {
    banner.hidden = true;
  }
}

// ============================================================
// 7. ĐIỀU HƯỚNG + XÁC NHẬN (không chấm điểm ngay)
// ============================================================

function getCurrentMaDe() {
  const sel = document.getElementById("selectMaDe");
  return state.maDeList.find(m => m.id === sel.value) || null;
}

function updatePendingCountLabel() {
  const pending = state.sheetCache.filter(c => c && c.confirmed && !c.graded).length;
  document.getElementById("pendingCountLabel").textContent =
    `${pending} phiếu đã xác nhận, chưa chấm điểm`;
}

async function confirmCurrentSheet() {
  syncCurrentIntoCache();
  const cache = state.sheetCache[state.currentIndex];
  if (cache) cache.confirmed = true;
  updatePendingCountLabel();

  const isLastSheet = state.currentIndex === state.pageCanvases.length - 1;

  if (!isLastSheet) {
    state.currentIndex++;
    await loadCurrentSheet();
  } else {
    document.getElementById("progressLabel").textContent =
      "Đã duyệt qua hết " + state.pageCanvases.length + " phiếu";
    alert(`Đã duyệt qua hết ${state.pageCanvases.length} phiếu trắc nghiệm.\nBấm "Chấm điểm toàn bộ" để tính điểm.`);
  }
}

async function goPrevSheet() {
  if (state.currentIndex > 0) {
    syncCurrentIntoCache();
    state.currentIndex--;
    await loadCurrentSheet();
  }
}

async function goNextSheet() {
  if (state.currentIndex < state.pageCanvases.length - 1) {
    syncCurrentIntoCache();
    state.currentIndex++;
    await loadCurrentSheet();
  }
}

// ============================================================
// 8. CHẤM ĐIỂM TOÀN BỘ — không cần danh sách sinh viên,
//    tự phát hiện trùng Candidate No. và cho chọn Bỏ qua / Ghi đè
// ============================================================

function showLoading(text) {
  document.getElementById("loadingText").textContent = text || "Đang xử lý...";
  document.getElementById("loadingOverlay").hidden = false;
}
function hideLoading() {
  document.getElementById("loadingOverlay").hidden = true;
}
function nextFrame() {
  return new Promise(resolve => setTimeout(resolve, 30));
}

function buildResultEntry(cache, maDe) {
  let dung = 0;
  const cauSai = [];
  const chiTiet = [];
  for (let q = 1; q <= SO_CAU; q++) {
    const dapAnDung = maDe.answers[q];
    const dapAnSV = cache.currentAnswers[q];
    const isDung = dapAnSV === dapAnDung;
    if (isDung) dung++;
    else if (!dapAnSV) cauSai.push(`${q}(bỏ trống)`);
    else cauSai.push(String(q));
    chiTiet.push({ cau: q, dapAnSV: dapAnSV || null, dapAnDung, dung: isDung });
  }
  const diem = dung * 5;
  const dungTong = `${dung}/${SO_CAU}`;
  const student = matchStudent(state.studentList, cache.candidateNo);

  return {
    candidateNo: cache.candidateNo || "(không đọc được)",
    hoTen: student ? student.hoTen : "",
    mssv: student ? student.mssv : "",
    matched: !!student,
    manualOverride: false,
    de: maDe.name,
    diem, dungTong, cauSai, chiTiet
  };
}

let blankKeyCounter = 0;

async function gradeAllConfirmedSheets() {
  const maDe = getCurrentMaDe();
  if (!maDe) { alert("Chưa chọn mã đề để chấm."); return; }

  const toGrade = [];
  state.sheetCache.forEach((cache, idx) => {
    if (cache && cache.confirmed && !cache.graded) toGrade.push({ cache, idx });
  });
  if (toGrade.length === 0) {
    alert("Không có phiếu nào đã xác nhận để chấm. Hãy \"Xác nhận\" ít nhất 1 phiếu trước.");
    return;
  }

  showLoading(`Đang chấm điểm ${toGrade.length} phiếu...`);
  await nextFrame();

  const committed = [];
  const conflicts = [];

  toGrade.forEach(({ cache, idx }) => {
    const entry = buildResultEntry(cache, maDe);
    const key = cache.candidateNo ? normalizeCandidateNo(cache.candidateNo) : ("blank_" + (blankKeyCounter++));

    if (key && state.gradedResults[key] !== undefined) {
      conflicts.push({ key, idx, existing: state.gradedResults[key], incoming: entry });
    } else {
      state.gradedResults[key] = entry;
      cache.graded = true;
      committed.push(entry);
    }
  });

  hideLoading();
  updatePendingCountLabel();
  renderResultTable();

  if (conflicts.length > 0) {
    state.pendingConflicts = conflicts;
    state.pendingFinish = { maDe, committed };
    showConflictModal();
  } else {
    await finishGrading(maDe, committed);
  }
}

function showConflictModal() {
  renderConflictList();
  document.getElementById("conflictModal").hidden = false;
}

function renderConflictList() {
  const listEl = document.getElementById("conflictList");
  listEl.innerHTML = "";
  state.pendingConflicts.forEach((c, i) => {
    const item = document.createElement("div");
    item.className = "conflict-item";
    item.innerHTML = `
      <div class="conflict-cand">Candidate No. ${formatCandidateNoDisplay(c.existing.candidateNo)}</div>
      <div class="conflict-row">Bài đã có: ${c.existing.de || "?"} — điểm ${c.existing.diem} (${c.existing.dungTong})</div>
      <div class="conflict-row">Bài mới quét: ${c.incoming.de || "?"} — điểm ${c.incoming.diem} (${c.incoming.dungTong})</div>
      <div class="conflict-actions">
        <button class="btn" data-action="skip" data-i="${i}">Bỏ qua (giữ bài cũ)</button>
        <button class="btn btn-primary" data-action="overwrite" data-i="${i}">Ghi đè (dùng bài mới)</button>
      </div>
    `;
    listEl.appendChild(item);
  });

  listEl.querySelectorAll("button[data-action]").forEach(btn => {
    btn.addEventListener("click", () => resolveConflict(parseInt(btn.dataset.i, 10), btn.dataset.action));
  });
}

async function resolveConflict(index, action) {
  const conflict = state.pendingConflicts[index];
  if (!conflict) return;
  const cacheEntry = findSheetCacheByIndex(conflict.idx);

  if (action === "overwrite") {
    state.gradedResults[conflict.key] = conflict.incoming;
    if (cacheEntry) cacheEntry.graded = true;
    state.pendingFinish.committed.push(conflict.incoming);
  } else {
    // Bỏ qua: giữ bài cũ, đánh dấu phiếu này đã xử lý xong (không chấm lại nữa)
    if (cacheEntry) cacheEntry.graded = true;
  }

  state.pendingConflicts.splice(index, 1);
  renderResultTable();
  updatePendingCountLabel();

  if (state.pendingConflicts.length === 0) {
    document.getElementById("conflictModal").hidden = true;
    const { maDe, committed } = state.pendingFinish;
    state.pendingFinish = null;
    await finishGrading(maDe, committed);
  } else {
    renderConflictList();
  }
}

function findSheetCacheByIndex(idx) {
  return state.sheetCache[idx];
}

async function finishGrading(maDe, committed) {
  let syncMsg = "";
  if (SheetsSync.isConfigured() && committed.length > 0) {
    showLoading(`Đang đồng bộ ${committed.length} kết quả lên Google Sheet...`);
    const synced = await SheetsSync.saveResultsBatch(committed);
    syncMsg = synced
      ? "\nĐã đồng bộ lên Google Sheet."
      : "\nĐồng bộ Google Sheet thất bại (kiểm tra URL/mạng) — kết quả vẫn còn trong app.";
    hideLoading();
  }

  alert(`Đã chấm ${committed.length} phiếu theo ${maDe.name}.${syncMsg}`);
  resetSheetPanelForNextExam();
}

function resetSheetPanelForNextExam() {
  state.pageCanvases = [];
  state.sheetCache = [];
  state.currentIndex = -1;
  if (state.warpedGrayMat) { state.warpedGrayMat.delete(); state.warpedGrayMat = null; }

  const canvasEl = document.getElementById("sheetCanvas");
  canvasEl.width = 0;
  canvasEl.height = 0;
  canvasEl.onclick = null;

  document.getElementById("progressLabel").textContent = "Chưa có phiếu nào";
  document.getElementById("debugThresholdLabel").textContent = "";
  document.getElementById("warningBanner").hidden = true;
  document.getElementById("manualCornerBanner").hidden = true;
  document.getElementById("cornerHandles").hidden = true;
  document.getElementById("btnAlignManual").hidden = true;
  document.getElementById("candidateNoValue").textContent = "—";
  document.getElementById("candidateNoName").textContent = "Chưa xác định sinh viên";
  document.getElementById("answerGrid").innerHTML = "";
  document.getElementById("btnPrevSheet").disabled = true;
  document.getElementById("btnNextSheet").disabled = true;
  document.getElementById("inputPdf").value = "";
  updatePendingCountLabel();
}

// ============================================================
// 9. TAB KẾT QUẢ — bảng gộp, sắp theo Candidate No., cho sửa tay tên/MSSV
// ============================================================

function renderResultTable() {
  const gradedRows = Object.entries(state.gradedResults).map(([key, entry]) => ({ key, ...entry, isPlaceholder: false }));

  // Hàng chờ: sinh viên có trong danh sách nhưng chưa có bài chấm nào khớp candidateNo
  const gradedKeys = new Set(Object.keys(state.gradedResults));
  const placeholderRows = state.studentList
    .filter(s => !gradedKeys.has(s.candidateNo))
    .map(s => ({ key: "placeholder_" + s.candidateNo, candidateNo: s.candidateNo, hoTen: s.hoTen, mssv: s.mssv, de: "", diem: null, dungTong: "", cauSai: [], isPlaceholder: true }));

  const allRows = [...gradedRows, ...placeholderRows];
  allRows.sort((a, b) => {
    const na = parseInt(a.candidateNo, 10);
    const nb = parseInt(b.candidateNo, 10);
    if (isNaN(na) && isNaN(nb)) return 0;
    if (isNaN(na)) return 1;
    if (isNaN(nb)) return -1;
    return na - nb;
  });

  const tbody = document.getElementById("resultTableBody");
  tbody.innerHTML = "";
  allRows.forEach(r => {
    const tr = document.createElement("tr");
    if (r.isPlaceholder) tr.classList.add("placeholder-row");
    else if (!r.matched) tr.classList.add("unmatched");

    const editable = !r.isPlaceholder;
    tr.innerHTML = `
      <td>${formatCandidateNoDisplay(r.candidateNo)}</td>
      <td class="editable-name" ${editable ? 'contenteditable="true"' : ""} data-key="${r.key}" data-field="hoTen">${r.hoTen ?? ""}</td>
      <td class="mssv-cell" ${editable ? 'contenteditable="true"' : ""} data-key="${r.key}" data-field="mssv">${r.isPlaceholder ? (r.mssv ?? "") : (r.mssv ?? "")}</td>
      <td>${r.de ?? ""}</td>
      <td>${r.diem !== null && r.diem !== undefined ? r.diem : ""}</td>
      <td>${r.dungTong ?? ""}</td>
      <td>${(r.cauSai || []).join(", ")}</td>
    `;
    tbody.appendChild(tr);
  });

  tbody.querySelectorAll("td[contenteditable='true']").forEach(td => {
    td.addEventListener("blur", onEditableCellBlur);
  });

  const gradedCount = gradedRows.filter(r => r.diem !== null).length;
  document.getElementById("statTotal").textContent = `${gradedCount} / ${allRows.length}`;
  const avg = gradedCount
    ? (gradedRows.reduce((s, r) => s + (r.diem || 0), 0) / gradedCount).toFixed(1)
    : "—";
  document.getElementById("statAvg").textContent = avg;
  document.getElementById("statUnmatched").textContent = gradedRows.filter(r => !r.matched).length;
  const maDe = getCurrentMaDe();
  document.getElementById("statMaDe").textContent = maDe ? maDe.name : "—";
}

function onEditableCellBlur(e) {
  const td = e.target;
  const key = td.dataset.key;
  const field = td.dataset.field;
  const entry = state.gradedResults[key];
  if (!entry) return;
  entry[field] = td.textContent.trim();
  entry.manualOverride = true;
}

async function exportExcel() {
  const rows = Object.values(state.gradedResults).filter(r => r.diem !== null && r.diem !== undefined);
  if (rows.length === 0) { alert("Chưa có kết quả để xuất."); return; }
  rows.sort((a, b) => (parseInt(a.candidateNo, 10) || 0) - (parseInt(b.candidateNo, 10) || 0));
  await exportResultsToExcel(rows, "ket_qua_cham_thi.xlsx");
}

// ============================================================
// 10. KHỞI TẠO
// ============================================================

function initEvents() {
  document.getElementById("btnAddMaDe").addEventListener("click", () => openMaDeEditor(null));
  document.getElementById("btnSaveMaDe").addEventListener("click", saveMaDe);
  document.getElementById("btnCancelMaDe").addEventListener("click", closeMaDeEditor);

  document.getElementById("inputStudentList").addEventListener("change", e => {
    if (e.target.files[0]) handleStudentListFileSelected(e.target.files[0]);
  });
  document.getElementById("btnUploadStudentList").addEventListener("click", uploadStudentList);

  document.getElementById("inputPdf").addEventListener("change", e => {
    if (e.target.files[0]) handlePdfUpload(e.target.files[0]);
  });

  document.getElementById("btnConfirmNext").addEventListener("click", confirmCurrentSheet);
  document.getElementById("btnGradeAll").addEventListener("click", gradeAllConfirmedSheets);
  document.getElementById("btnExportExcel").addEventListener("click", exportExcel);
  document.getElementById("btnAlignManual").addEventListener("click", alignManually);

  document.getElementById("btnPrevSheet").addEventListener("click", goPrevSheet);
  document.getElementById("btnNextSheet").addEventListener("click", goNextSheet);
  document.getElementById("btnZoomIn").addEventListener("click", () => { state.zoom = Math.min(2, state.zoom + 0.2); applyZoom(); });
  document.getElementById("btnZoomOut").addEventListener("click", () => { state.zoom = Math.max(0.4, state.zoom - 0.2); applyZoom(); });
  document.getElementById("btnDebugMarkers").addEventListener("click", enterManualCorrectionMode);
}

function applyZoom() {
  const canvasEl = document.getElementById("sheetCanvas");
  canvasEl.style.transform = `scale(${state.zoom})`;
  canvasEl.style.transformOrigin = "top left";
}

async function init() {
  initTabs();
  loadMaDeList();
  renderMaDeList();
  renderAnswerGrid();
  renderResultTable();
  updatePendingCountLabel();
  initEvents();
  await syncMaDeListFromSheet();
}

document.addEventListener("DOMContentLoaded", init);
