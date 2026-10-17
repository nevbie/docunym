// Local text recognition with Tesseract. All files (worker, wasm core, German language data) are bundled
// in the app under /tesseract/ – nothing is downloaded.
import { createWorker, OEM, PSM, type Worker } from 'tesseract.js';
import type { OcrLine } from './core/detect';

const FILES = ['worker.min.js', 'tesseract-core-lstm.wasm.js', 'deu.traineddata'];
const STAGES: Record<string, string> = {
  'loading tesseract core': 'Texterkennung wird geladen',
  'initializing tesseract': 'Texterkennung wird vorbereitet',
  'loading language traineddata': 'Deutsche Sprachdaten werden geladen',
  'initializing api': 'Texterkennung wird initialisiert',
  'recognizing text': 'Text wird erkannt',
};
/** Without any sign of life for this long the engine is considered stuck. */
const STALL_MS = 90_000;

export type Progress = (text: string, p: number) => void;

let worker: Promise<Worker> | null = null;
let listener: Progress | null = null;
let lastStage = 'Start';
let lastSignal = 0;

const base = (p: string) => new URL(p, location.href).href;

function report(status: string, p: number) {
  lastStage = STAGES[status] ?? status;
  lastSignal = Date.now();
  listener?.(lastStage, p);
}

/** Checks that the bundled OCR files are reachable, so a broken build gives a clear message instead of a hang. */
async function checkFiles() {
  for (const f of FILES) {
    // GET instead of HEAD: the app's local file server does not reliably answer HEAD requests.
    const r = await fetch(base(`tesseract/${f}`)).catch(() => null);
    if (!r?.ok) throw new Error(`Datei der Texterkennung fehlt: ${f}${r ? ` (${r.status})` : ''}`);
    await r.body?.cancel();
  }
}

function getWorker(): Promise<Worker> {
  worker ??= (async () => {
    report('Dateien werden geprüft', 0);
    await checkFiles();
    const w = await createWorker('deu', OEM.LSTM_ONLY, {
      workerPath: base('tesseract/worker.min.js'),
      corePath: base('tesseract/'),
      langPath: base('tesseract'),
      gzip: false,
      cacheMethod: 'none',
      workerBlobURL: false,
      logger: (m) => report(m.status, m.progress),
      errorHandler: () => {}, // errors are rejected through the job promises
    });
    await w.setParameters({ tessedit_pageseg_mode: PSM.AUTO, preserve_interword_spaces: '1' });
    return w;
  })();
  worker.catch(() => { worker = null; });
  return worker;
}

/** Starts loading the OCR engine in the background. */
export function warmUp(): void { getWorker().catch(() => {}); }

/** Rejects when the engine shows no progress for STALL_MS, and then throws the engine away. */
function watchdog<T>(job: Promise<T>): Promise<T> {
  lastSignal = Date.now();
  return new Promise<T>((resolve, reject) => {
    const timer = setInterval(() => {
      if (Date.now() - lastSignal < STALL_MS) return;
      clearInterval(timer);
      const stuck = worker;
      worker = null;
      stuck?.then((w) => w.terminate()).catch(() => {});
      reject(new Error(`Texterkennung reagiert nicht (Schritt: ${lastStage})`));
    }, 1000);
    job.then(resolve, reject).finally(() => clearInterval(timer));
  });
}

/**
 * Recognises the text of `source` and returns its lines with word boxes in source pixel coordinates.
 * Small screenshots are enlarged and huge photos reduced, which helps both accuracy and speed.
 */
export async function recognize(source: HTMLCanvasElement, progress: Progress): Promise<OcrLine[]> {
  listener = progress;
  try {
    return await watchdog(run(source));
  } finally {
    listener = null;
  }
}

async function run(source: HTMLCanvasElement): Promise<OcrLine[]> {
  const long = Math.max(source.width, source.height);
  const scale = long < 1400 ? 2 : long > 3000 ? 3000 / long : 1;
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
  report('recognizing text', 0);
  const { data } = await w.recognize(input, {}, { blocks: true, text: false });
  if (input !== source) input.width = input.height = 0;
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
        // rowHeight ≈ cap height (+ ascenders), descenders is negative; together ≈ 1 em.
        const fontSize = ra && ra.rowHeight > 0 ? (ra.rowHeight - Math.min(0, ra.descenders)) / scale : undefined;
        if (words.length) lines.push({ words, bbox: box(line.bbox), baseline: line.baseline && box(line.baseline), fontSize });
      }
    }
  }
  return lines;
}
