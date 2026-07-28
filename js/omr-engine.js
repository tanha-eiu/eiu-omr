// =========================================================
// Engine OMR — dùng OpenCV.js
// Luồng: ảnh scan (canvas) -> dò 4 marker góc -> warp phối cảnh
// về đúng khung REF -> đọc độ đậm từng bubble theo tọa độ TEMPLATE
// -> suy ra số báo danh + đáp án + các cờ "cần review"
// =========================================================

// Ngưỡng đọc bubble — TÍNH THÍCH ỨNG theo từng phiếu (xem computeAdaptiveFillThreshold),
// không dùng số cố định, vì độ đậm bút chì/bút mực và độ sáng scan khác nhau rất nhiều.
// Giá trị grayscale 0 (đen) - 255 (trắng).
const OMR_THRESHOLDS = {
  DROP_MARGIN: 35,       // bubble được coi là "có tô" nếu tối hơn nền giấy trắng ít nhất ngần này
  MIN_THRESHOLD: 140,    // chặn dưới, tránh threshold quá thấp nếu scan bị tối/nhiễu
  MAX_THRESHOLD: 225,    // chặn trên, tránh threshold quá cao gây tô nhầm vệt mờ/bóng giấy
  FAINT_MARGIN: 20,      // trong khoảng [threshold-20, threshold) coi là tô mờ -> cần review
  MULTI_MARGIN: 30       // nếu >1 bubble có độ đậm gần bubble đậm nhất (trong khoảng này) -> coi là tô nhiều ô
};

// ---------------------------------------------------------
// 1. DÒ 4 MARKER GÓC
// ---------------------------------------------------------

// Trả về {tl,tr,bl,br} (mỗi giá trị {x,y} hoặc null nếu không tìm thấy)
function detectMarkers(cvSrc) {
  const w = cvSrc.cols, h = cvSrc.rows;
  const pageArea = w * h;
  const gray = new cv.Mat();
  cv.cvtColor(cvSrc, gray, cv.COLOR_RGBA2GRAY);
  const bin = new cv.Mat();
  cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY_INV + cv.THRESH_OTSU);

  const windows = {
    tl: { x0: 0,        y0: 0,        x1: 0.15 * w, y1: 0.12 * h, corner: { x: 0, y: 0 } },
    tr: { x0: 0.85 * w, y0: 0,        x1: w,        y1: 0.12 * h, corner: { x: w, y: 0 } },
    bl: { x0: 0,        y0: 0.88 * h, x1: 0.15 * w, y1: h,        corner: { x: 0, y: h } },
    br: { x0: 0.85 * w, y0: 0.88 * h, x1: w,        y1: h,        corner: { x: w, y: h } }
  };

  const result = {};
  for (const key of Object.keys(windows)) {
    const win = windows[key];
    const x0 = Math.round(win.x0), y0 = Math.round(win.y0);
    const rw = Math.round(win.x1 - win.x0), rh = Math.round(win.y1 - win.y0);
    const roi = bin.roi(new cv.Rect(x0, y0, rw, rh));

    const contours = new cv.MatVector();
    const hierarchy = new cv.Mat();
    cv.findContours(roi, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    // Marker thật rất nhỏ (~0.01% diện tích trang) và luôn nằm sát góc trang nhất.
    // Không chọn contour lớn nhất (dễ bắt nhầm logo/chữ), mà chọn contour GẦN GÓC TRANG NHẤT
    // trong số các contour có hình dạng và kích thước hợp lý.
    let best = null;
    for (let i = 0; i < contours.size(); i++) {
      const c = contours.get(i);
      const rect = cv.boundingRect(c);
      const area = rect.width * rect.height;
      const aspect = rect.width / Math.max(rect.height, 1);
      if (aspect > 1.6 && aspect < 8 && area > 40 && area < pageArea * 0.0006) {
        const cx = x0 + rect.x + rect.width / 2;
        const cy = y0 + rect.y + rect.height / 2;
        const dist = Math.hypot(cx - win.corner.x, cy - win.corner.y);
        if (!best || dist < best.dist) {
          best = { dist, cx, cy };
        }
      }
      c.delete();
    }
    result[key] = best ? { x: best.cx, y: best.cy } : null;

    roi.delete(); contours.delete(); hierarchy.delete();
  }

  gray.delete(); bin.delete();
  return result;
}

// ---------------------------------------------------------
// 1.5. KIỂM TRA AN TOÀN — 4 góc dò được có tạo thành tứ giác hợp lý không
// ---------------------------------------------------------

// So sánh tỉ lệ khung hình (rộng/cao) của 4 điểm dò được với tỉ lệ phiếu chuẩn.
// Nếu dò sai marker (bắt nhầm điểm khác), tứ giác thường bị méo bất thường,
// tỉ lệ lệch hẳn khỏi phiếu thật -> phát hiện được và từ chối thay vì âm thầm cho ra
// kết quả sai lệch khắp phiếu.
function areCornersPlausible(corners) {
  const w1 = Math.hypot(corners.tr.x - corners.tl.x, corners.tr.y - corners.tl.y);
  const w2 = Math.hypot(corners.br.x - corners.bl.x, corners.br.y - corners.bl.y);
  const h1 = Math.hypot(corners.bl.x - corners.tl.x, corners.bl.y - corners.tl.y);
  const h2 = Math.hypot(corners.br.x - corners.tr.x, corners.br.y - corners.tr.y);
  const avgW = (w1 + w2) / 2, avgH = (h1 + h2) / 2;

  if (avgW < 10 || avgH < 10) return false; // 4 điểm gần như trùng nhau -> chắc chắn sai

  const aspect = avgW / avgH;
  const expectedAspect = TEMPLATE.refWidth / TEMPLATE.refHeight;
  if (aspect < expectedAspect * 0.7 || aspect > expectedAspect * 1.3) return false;

  // 2 cạnh đối diện (trên/dưới, trái/phải) không nên lệch nhau quá nhiều
  if (Math.abs(w1 - w2) / avgW > 0.35) return false;
  if (Math.abs(h1 - h2) / avgH > 0.35) return false;

  return true;
}

// ---------------------------------------------------------
// 2. CĂN CHỈNH PHỐI CẢNH VỀ KHUNG THAM CHIẾU
// ---------------------------------------------------------

// corners: {tl,tr,br,bl} tọa độ thực tế trên ảnh scan (đã dò được hoặc do người dùng kéo chỉnh tay)
// Trả về cv.Mat grayscale kích thước TEMPLATE.refWidth x TEMPLATE.refHeight
function warpToReference(cvSrc, corners) {
  const srcTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    corners.tl.x, corners.tl.y,
    corners.tr.x, corners.tr.y,
    corners.br.x, corners.br.y,
    corners.bl.x, corners.bl.y
  ]);
  const m = TEMPLATE.markers;
  const dstTri = cv.matFromArray(4, 1, cv.CV_32FC2, [
    m.tl.x, m.tl.y, m.tr.x, m.tr.y, m.br.x, m.br.y, m.bl.x, m.bl.y
  ]);

  const M = cv.getPerspectiveTransform(srcTri, dstTri);
  const dsize = new cv.Size(TEMPLATE.refWidth, TEMPLATE.refHeight);
  const warped = new cv.Mat();
  cv.warpPerspective(cvSrc, warped, M, dsize, cv.INTER_LINEAR, cv.BORDER_CONSTANT, new cv.Scalar());

  const gray = new cv.Mat();
  cv.cvtColor(warped, gray, cv.COLOR_RGBA2GRAY);

  srcTri.delete(); dstTri.delete(); M.delete(); warped.delete();
  return gray; // cv.Mat 1 kênh, kích thước refWidth x refHeight
}

// ---------------------------------------------------------
// 3. ĐỌC ĐỘ ĐẬM BUBBLE
// ---------------------------------------------------------

// grayMat: cv.Mat 1 kênh (từ warpToReference). Trả về độ đậm trung bình
// (0=đen tuyệt đối, 255=trắng tuyệt đối) trong vùng tròn quanh (cx,cy)
function sampleBubbleDarkness(grayMat, cx, cy, radius) {
  const data = grayMat.data; // Uint8Array, hàng-chính (row-major)
  const width = grayMat.cols, height = grayMat.rows;
  const r = radius * 0.65; // lấy mẫu vùng trong lõi bubble, tránh viền in
  let sum = 0, count = 0;

  const x0 = Math.max(0, Math.floor(cx - r));
  const x1 = Math.min(width - 1, Math.ceil(cx + r));
  const y0 = Math.max(0, Math.floor(cy - r));
  const y1 = Math.min(height - 1, Math.ceil(cy + r));

  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dx = x - cx, dy = y - cy;
      if (dx * dx + dy * dy <= r * r) {
        sum += data[y * width + x];
        count++;
      }
    }
  }
  return count > 0 ? sum / count : 255;
}

// ---------------------------------------------------------
// 3.5. TÍNH NGƯỠNG "CÓ TÔ" THÍCH ỨNG THEO TỪNG PHIẾU
// ---------------------------------------------------------

// Lấy mẫu độ đậm của TOÀN BỘ bubble trên phiếu (20 câu x5 lựa chọn + 4 cột số báo danh).
// Vì đa số bubble luôn KHÔNG được tô (chỉ ~15-20% có tô), trung vị của toàn bộ mẫu
// gần như chắc chắn rơi vào nhóm "giấy trắng chưa tô" -> dùng làm mốc nền, rồi trừ đi
// một khoảng an toàn để ra ngưỡng "có tô". Cách này tự thích nghi với bút chì (xám nhạt)
// hay bút mực (đen đậm), và với ảnh scan sáng/tối khác nhau, thay vì đoán 1 số cố định.
function computeAdaptiveFillThreshold(grayMat) {
  const samples = [];
  const qcfg = TEMPLATE.questions;
  for (let qi = 0; qi < qcfg.count; qi++) {
    const cy = qcfg.rowY[qi];
    qcfg.options.forEach(opt => {
      samples.push(sampleBubbleDarkness(grayMat, qcfg.colX[opt], cy, TEMPLATE.bubbleRadius));
    });
  }
  const ccfg = TEMPLATE.candidateNo;
  for (let c = 0; c < ccfg.numDigits; c++) {
    for (let d = 0; d < ccfg.numOptions; d++) {
      samples.push(sampleBubbleDarkness(grayMat, ccfg.colX[c], ccfg.rowY0 + ccfg.rowStep * d, TEMPLATE.bubbleRadius));
    }
  }
  samples.sort((a, b) => a - b);
  const median = samples[Math.floor(samples.length / 2)];
  const threshold = median - OMR_THRESHOLDS.DROP_MARGIN;
  return Math.max(OMR_THRESHOLDS.MIN_THRESHOLD, Math.min(OMR_THRESHOLDS.MAX_THRESHOLD, threshold));
}

// ---------------------------------------------------------
// 4. SUY RA SỐ BÁO DANH
// ---------------------------------------------------------

function readCandidateNo(grayMat, fillThreshold) {
  const cfg = TEMPLATE.candidateNo;
  const columns = []; // mỗi phần tử: {digit: number|null, review: bool}

  for (let c = 0; c < cfg.numDigits; c++) {
    const intensities = [];
    for (let d = 0; d < cfg.numOptions; d++) {
      const cx = cfg.colX[c];
      const cy = cfg.rowY0 + cfg.rowStep * d;
      intensities.push(sampleBubbleDarkness(grayMat, cx, cy, TEMPLATE.bubbleRadius));
    }
    const minVal = Math.min(...intensities);

    if (minVal >= fillThreshold) {
      // cột không có bubble nào được tô -> bỏ qua cột này (không phải lỗi)
      columns.push({ digit: null, review: false, blank: true });
      continue;
    }

    const marks = intensities
      .map((v, i) => ({ v, i }))
      .filter(o => o.v <= minVal + OMR_THRESHOLDS.MULTI_MARGIN && o.v < fillThreshold);

    const bestDigit = intensities.indexOf(minVal);
    const faint = minVal >= fillThreshold - OMR_THRESHOLDS.FAINT_MARGIN;

    columns.push({
      digit: bestDigit,
      review: marks.length > 1 || faint,
      blank: false
    });
  }

  const nonBlank = columns.filter(c => !c.blank);
  const candidateNo = nonBlank.length > 0 ? nonBlank.map(c => c.digit).join("") : null;
  const review = nonBlank.length === 0 || nonBlank.some(c => c.review);

  return { candidateNo, review, columns };
}

// ---------------------------------------------------------
// 5. SUY RA 20 ĐÁP ÁN
// ---------------------------------------------------------

function readAnswers(grayMat, fillThreshold) {
  const cfg = TEMPLATE.questions;
  const answers = {};   // {1: "B", 2: null, ...}
  const reviewFlags = {}; // {1: true, ...} chỉ có key khi cần review

  for (let qi = 0; qi < cfg.count; qi++) {
    const q = qi + 1;
    const cy = cfg.rowY[qi];
    const intensities = cfg.options.map(opt =>
      sampleBubbleDarkness(grayMat, cfg.colX[opt], cy, TEMPLATE.bubbleRadius)
    );
    const minVal = Math.min(...intensities);

    if (minVal >= fillThreshold) {
      answers[q] = null; // bỏ trống — sinh viên không làm, không phải lỗi hệ thống
      continue;
    }

    const marks = intensities
      .map((v, i) => ({ v, i }))
      .filter(o => o.v <= minVal + OMR_THRESHOLDS.MULTI_MARGIN && o.v < fillThreshold);

    const bestIdx = intensities.indexOf(minVal);
    answers[q] = cfg.options[bestIdx];

    const faint = minVal >= fillThreshold - OMR_THRESHOLDS.FAINT_MARGIN;
    if (marks.length > 1 || faint) {
      reviewFlags[q] = true;
    }
  }

  return { answers, reviewFlags };
}

// ---------------------------------------------------------
// 6. HÀM TỔNG HỢP — xử lý 1 ảnh phiếu từ đầu đến cuối
// ---------------------------------------------------------

// canvas: canvas chứa ảnh 1 trang scan (từ pdf-loader)
// manualCorners: nếu có, dùng thay cho auto-detect (dùng khi người dùng tự kéo chỉnh 4 góc)
// Trả về { ok, error?, markersFound, corners, warpedGray, candidateResult, answerResult }
function processSheet(canvas, manualCorners) {
  const src = cv.imread(canvas);
  let corners = manualCorners;
  let markersFound = true;

  if (!corners) {
    const detected = detectMarkers(src);
    if (!detected.tl || !detected.tr || !detected.bl || !detected.br) {
      src.delete();
      return { ok: false, error: "Không dò được đủ 4 marker góc", markersFound: false };
    }
    if (!areCornersPlausible(detected)) {
      src.delete();
      return { ok: false, error: "4 marker dò được tạo tứ giác bất thường (có thể bắt nhầm điểm)", markersFound: false };
    }
    corners = detected;
  }

  const warpedGray = warpToReference(src, corners);
  const fillThreshold = computeAdaptiveFillThreshold(warpedGray);
  const candidateResult = readCandidateNo(warpedGray, fillThreshold);
  const answerResult = readAnswers(warpedGray, fillThreshold);

  src.delete();

  return {
    ok: true,
    markersFound,
    corners,
    warpedGray,     // cv.Mat — nhớ .delete() sau khi dùng xong để tránh rò rỉ bộ nhớ
    fillThreshold,   // hữu ích để debug nếu cần xem ngưỡng đã tính ra bao nhiêu
    candidateResult,
    answerResult
  };
}

// Chuyển cv.Mat grayscale (đã warp) thành canvas để hiển thị preview
function grayMatToCanvas(grayMat) {
  const canvas = document.createElement("canvas");
  cv.imshow(canvas, grayMat);
  return canvas;
}
