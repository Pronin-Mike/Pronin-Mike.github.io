export interface RecognitionProgress {
  stage: string;
  progress: number;
}

const MAX_IMAGE_EDGE = 2600;

async function prepareImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(bitmap.width, bitmap.height));
    if (scale === 1) return file;
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Браузер не поддерживает подготовку изображения');
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error('Не удалось подготовить изображение')), 'image/jpeg', 0.9)
    );
  } finally {
    bitmap.close();
  }
}

export async function recognizeImage(file: File, onProgress: (value: RecognitionProgress) => void): Promise<string> {
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('rus+eng', 1, {
    logger: (message) => onProgress({ stage: message.status, progress: message.progress })
  });
  try {
    const image = await prepareImage(file);
    const result = await worker.recognize(image);
    return result.data.text.trim();
  } finally {
    await worker.terminate();
  }
}

export async function extractPdfText(
  file: File,
  onProgress: (value: RecognitionProgress) => void
): Promise<{ text: string; hasTextLayer: boolean; pages: number }> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdfDocument = await loadingTask.promise;
  const parts: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      parts.push(content.items.map((item) => 'str' in item ? item.str : '').join(' '));
      onProgress({ stage: 'Читаем PDF', progress: pageNumber / pdfDocument.numPages });
      page.cleanup();
    }
  } finally {
    await loadingTask.destroy();
  }
  const text = parts.join('\n').trim();
  return { text, hasTextLayer: text.replace(/\s/g, '').length > 20, pages: parts.length };
}

export async function recognizePdfPages(
  file: File,
  onProgress: (value: RecognitionProgress) => void
): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const workerUrl = await import('pdfjs-dist/build/pdf.worker.min.mjs?url');
  const { createWorker } = await import('tesseract.js');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl.default;
  const loadingTask = pdfjs.getDocument({ data: await file.arrayBuffer() });
  const pdfDocument = await loadingTask.promise;
  const worker = await createWorker('rus+eng');
  const parts: string[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdfDocument.numPages; pageNumber += 1) {
      const page = await pdfDocument.getPage(pageNumber);
      const initial = page.getViewport({ scale: 1 });
      const scale = Math.min(2, MAX_IMAGE_EDGE / Math.max(initial.width, initial.height));
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const context = canvas.getContext('2d');
      if (!context) throw new Error('Браузер не поддерживает распознавание PDF');
      await page.render({ canvas, canvasContext: context, viewport }).promise;
      const result = await worker.recognize(canvas);
      parts.push(result.data.text);
      onProgress({ stage: `Распознаём страницу ${pageNumber} из ${pdfDocument.numPages}`, progress: pageNumber / pdfDocument.numPages });
      page.cleanup();
      canvas.width = 1;
      canvas.height = 1;
    }
    return parts.join('\n').trim();
  } finally {
    await worker.terminate();
    await loadingTask.destroy();
  }
}
