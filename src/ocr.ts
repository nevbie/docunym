// Local text recognition with Tesseract. All files (worker, wasm core, German language data) are bundled
// in the app under /tesseract/ – nothing is downloaded.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrLine } from './core/detect';

let worker: Promise<Worker> | null = null;
let onProgress: ((p: number) => void) | null = null;

function getWorker(): Promise<Worker> {
  const base = (p: string) => new URL(p, location.href).href;
  worker ??= createWorker('deu', OEM.LSTM_ONLY, {
    workerPath: base('tesseract/worker.min.js'),
    corePath: base('tesseract/'),
    langPath: base('tesseract/'),
    gzip: true,
    cacheMethod: 'none',
    workerBlobURL: false,
    logger: (m) => { if (m.status === 'recognizing text') onProgress?.(m.progress); },
  }).then(async (w) => {
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    return w;
  });
  return worker;
}

/** Starts loading the OCR engine in the background. */
export function warmUp(): void { getWorker().catch(() => { worker = null; }); }

/**
 * Recognises the text of `source` and returns its lines with word boxes in source pixel coordinates.
 * Small screenshots are enlarged and huge photos reduced, which helps both accuracy and speed.
 */
export async function recognize(source: HTMLCanvasElement, progress: (p: number) => void): Promise<OcrLine[]> {
  const long = Math.max(source.width, source.height);
  const scale = long < 1400 ? 2 : long > 3200 ? 3200 / long : 1;
  let input = source;
  if (scale !== 1) {
    input = document.createElement('canvas');
    input.width = Math.round(source.width * scale);
    input.height = Math.round(source.height * scale);
    const ctx = input.getContext('2d')!;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(source, 0, 0, input.width, input.height);
  }
  const w = await getWorker();
  onProgress = progress;
  try {
    const { data } = await w.recognize(input, {}, { blocks: true, text: false });
    const box = (b: { x0: number; y0: number; x1: number; y1: number }) =>
      ({ x0: b.x0 / scale, y0: b.y0 / scale, x1: b.x1 / scale, y1: b.y1 / scale });
    const lines: OcrLine[] = [];
    for (const block of data.blocks ?? []) {
      for (const para of block.paragraphs) {
        for (const line of para.lines) {
          const words = line.words
            .filter((wd) => wd.text.trim() !== '')
            .map((wd) => ({ text: wd.text, bbox: box(wd.bbox) }));
          const ra = line.rowAttributes;
          // rowHeight ≈ cap height (+ ascenders), descenders is negative; together ≈ 0.9 em.
          const fontSize = ra && ra.rowHeight > 0 ? (ra.rowHeight - Math.min(0, ra.descenders)) / scale : undefined;
          if (words.length) lines.push({ words, bbox: box(line.bbox), baseline: line.baseline && box(line.baseline), fontSize });
        }
      }
    }
    return lines;
  } finally {
    onProgress = null;
  }
}
