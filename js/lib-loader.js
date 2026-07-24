// =========================================================
// Tải thư viện ngoài qua CDN, dùng Promise để biết khi nào sẵn sàng
// =========================================================

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error("Không tải được: " + src));
    document.head.appendChild(s);
  });
}

// ---- PDF.js ----
const PdfLib = {
  ready: null,
  load() {
    if (this.ready) return this.ready;
    this.ready = loadScript("https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js")
      .then(() => {
        window["pdfjsLib"].GlobalWorkerOptions.workerSrc =
          "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
      });
    return this.ready;
  }
};

// ---- OpenCV.js ----
// Thử lần lượt 2 nguồn: trang chính thức OpenCV, rồi tới CDN jsDelivr
// (một số mạng nội bộ trường/công ty có thể chặn domain đầu tiên).
const OPENCV_SOURCES = [
  "https://docs.opencv.org/4.x/opencv.js",
  "https://cdn.jsdelivr.net/npm/@techstark/opencv-js@4.10.0-release.1"
];

const CvLib = {
  ready: null,
  load() {
    if (this.ready) return this.ready;
    this.ready = this._loadFromSources(0);
    return this.ready;
  },
  async _loadFromSources(idx) {
    if (idx >= OPENCV_SOURCES.length) {
      throw new Error("Không tải được OpenCV.js từ bất kỳ nguồn nào. Kiểm tra kết nối mạng.");
    }
    try {
      await this._loadOne(OPENCV_SOURCES[idx]);
    } catch (err) {
      console.warn("OpenCV.js nguồn thất bại, thử nguồn tiếp theo:", OPENCV_SOURCES[idx], err);
      return this._loadFromSources(idx + 1);
    }
  },
  _loadOne(src) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error("Quá thời gian chờ tải: " + src)), 20000);
      const s = document.createElement("script");
      s.src = src;
      s.onload = () => {
        const cvObj = window["cv"];
        if (cvObj && cvObj instanceof Promise) {
          // build dạng module (ví dụ @techstark/opencv-js) trả về Promise
          cvObj.then(resolvedCv => {
            window["cv"] = resolvedCv;
            clearTimeout(timeout);
            resolve();
          }).catch(reject);
        } else if (cvObj && cvObj.Mat) {
          clearTimeout(timeout);
          resolve();
        } else if (cvObj) {
          cvObj["onRuntimeInitialized"] = () => { clearTimeout(timeout); resolve(); };
        } else {
          clearTimeout(timeout);
          reject(new Error("Không thấy đối tượng cv sau khi tải: " + src));
        }
      };
      s.onerror = () => { clearTimeout(timeout); reject(new Error("Lỗi tải script: " + src)); };
      document.head.appendChild(s);
    });
  }
};

// ---- SheetJS ----
const XlsxLib = {
  ready: null,
  load() {
    if (this.ready) return this.ready;
    this.ready = loadScript("https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js");
    return this.ready;
  }
};
