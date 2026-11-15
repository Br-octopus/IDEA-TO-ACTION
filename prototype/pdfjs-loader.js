window.ForwardStepPdfjsReady = import("/node_modules/pdfjs-dist/legacy/build/pdf.mjs").then(async pdfjs => {
  pdfjs.GlobalWorkerOptions.workerSrc = "/node_modules/pdfjs-dist/legacy/build/pdf.worker.mjs";
  globalThis.pdfjsLib = pdfjs;
  const viewer = await import("/node_modules/pdfjs-dist/web/pdf_viewer.mjs");
  return { pdfjs, viewer };
});
