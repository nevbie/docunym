// Copies the Tesseract worker, wasm core and German language data into public/tesseract,
// so the app can recognise text without any network access.
import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const out = new URL('../public/tesseract/', import.meta.url).pathname;
mkdirSync(out, { recursive: true });

const tess = dirname(require.resolve('tesseract.js/package.json'));
copyFileSync(join(tess, 'dist/worker.min.js'), join(out, 'worker.min.js'));

const core = dirname(require.resolve('tesseract.js-core/package.json'));
for (const f of readdirSync(core)) if (/-lstm\.wasm\.js$/.test(f)) copyFileSync(join(core, f), join(out, f));

const deu = dirname(require.resolve('@tesseract.js-data/deu/package.json'));
copyFileSync(join(deu, '4.0.0_best_int/deu.traineddata.gz'), join(out, 'deu.traineddata.gz'));
console.log('OCR files copied to public/tesseract');
