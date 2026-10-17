# Docunym – notes for working on this repo

Android app (Capacitor 8, TypeScript, Canvas 2D, Tesseract.js) that anonymises photos of documents and
screenshots fully offline. APK built by `.github/workflows/android.yml`.

## Rules
- UI texts are German. Dark, sober look. No emojis – use the SVG icons in `src/icons.ts`.
- **Never add network access**: no INTERNET permission (the CI checks the APK), no CDN URLs, no analytics,
  keep the CSP in `index.html` strict. OCR files are bundled by `scripts/copy-ocr.mjs`.
- Exported images must stay re-encoded canvas pixels (no EXIF) with a random file name (`anonymousFileName`).
- Detection/replacement logic lives in `src/core/` (no DOM) and is covered by `tests/detect.test.ts`.
- Before pushing: `npx tsc --noEmit && npx vitest run && npm run build`.
- `android/app/anonymisierer.keystore` is the fixed signing key (updates install over the old app). Don't replace it.
