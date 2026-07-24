// =========================================================
// Tách PDF nhiều trang (scan cả lô) thành từng canvas ảnh
// =========================================================

// Render tất cả các trang của file PDF thành mảng canvas.
// scale=2 tương đương ~144-200dpi tùy kích thước trang gốc,
// đủ chi tiết để đọc bubble mà không quá nặng.
async function renderPdfToCanvases(file, scale = 2.2) {
  await PdfLib.load();

  const arrayBuffer = await file.arrayBuffer();
  const pdf = await window["pdfjsLib"].getDocument({ data: arrayBuffer }).promise;

  const canvases = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = viewport.width;
    canvas.height = viewport.height;
    const ctx = canvas.getContext("2d");

    await page.render({ canvasContext: ctx, viewport }).promise;
    canvases.push(canvas);
  }
  return canvases;
}
