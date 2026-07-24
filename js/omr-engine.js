// =========================================================
// Engine OMR — dùng OpenCV.js
// Luồng: ảnh scan (canvas) -> dò 4 marker góc -> warp phối cảnh
// về đúng khung REF -> đọc độ đậm từng bubble theo tọa độ TEMPLATE
// -> suy ra số báo danh + đáp án + các cờ "cần review"
// =========================================================

// Ngưỡng đọc bubble — có thể cần tinh chỉnh sau khi test với scan thật.
// Giá trị grayscale 0 (đen) - 255 (trắng).
const OMR_THRESHOLDS = {
  FILL_MAX: 175,        // dưới ngưỡng này coi là "có khả năng được tô"
  FAINT_MARGIN: 35,      // trong khoảng [FILL_MAX-35, FILL_MAX] coi là tô mờ -> cần review
  MULTI_MARGIN: 40       // nếu >1 bubble có độ đậm gần bubble đậm nhất (trong khoảng này) -> coi là tô nhiều ô
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
// 4. SUY RA SỐ BÁO DANH
// ---------------------------------------------------------

function readCandidateNo(grayMat) {
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

    if (minVal >= OMR_THRESHOLDS.FILL_MAX) {
      // cột không có bubble nào được tô -> bỏ qua cột này (không phải lỗi)
      columns.push({ digit: null, review: false, blank: true });
      continue;
    }

    const marks = intensities
      .map((v, i) => ({ v, i }))
      .filter(o => o.v <= minVal + OMR_THRESHOLDS.MULTI_MARGIN && o.v < OMR_THRESHOLDS.FILL_MAX);

    const bestDigit = intensities.indexOf(minVal);
    const faint = minVal >= OMR_THRESHOLDS.FILL_MAX - OMR_THRESHOLDS.FAINT_MARGIN;

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

function readAnswers(grayMat) {
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

    if (minVal >= OMR_THRESHOLDS.FILL_MAX) {
      answers[q] = null; // bỏ trống — sinh viên không làm, không phải lỗi hệ thống
      continue;
    }

    const marks = intensities
      .map((v, i) => ({ v, i }))
      .filter(o => o.v <= minVal + OMR_THRESHOLDS.MULTI_MARGIN && o.v < OMR_THRESHOLDS.FILL_MAX);

    const bestIdx = intensities.indexOf(minVal);
    answers[q] = cfg.options[bestIdx];

    const faint = minVal >= OMR_THRESHOLDS.FILL_MAX - OMR_THRESHOLDS.FAINT_MARGIN;
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
    corners = detected;
  }

  const warpedGray = warpToReference(src, corners);
  const candidateResult = readCandidateNo(warpedGray);
  const answerResult = readAnswers(warpedGray);

  src.delete();

  return {
    ok: true,
    markersFound,
    corners,
    warpedGray,     // cv.Mat — nhớ .delete() sau khi dùng xong để tránh rò rỉ bộ nhớ
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
