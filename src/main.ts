import './style.css';
import type { Category } from './core/detect';
import { CATEGORY_COLOR, CATEGORY_LABEL, Editor } from './editor';
import { icons } from './icons';
import { recognize, warmUp } from './ocr';
import { clearShareCache, pickImage, saveImage, shareImage, takePhoto } from './platform';

const app = document.getElementById('app')!;
let editor: Editor | null = null;
let saved = false;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = html;
  return el;
}

function toast(text: string, ms = 2800) {
  const t = h('div', { class: 'toast', role: 'status' });
  t.textContent = text;
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

function busy(text: string) {
  const el = h('div', { class: 'busy' }, `<div class="box"><div class="label"></div><div class="track"><div class="fill"></div></div></div>`);
  const label = el.querySelector<HTMLElement>('.label')!;
  const fill = el.querySelector<HTMLElement>('.fill')!;
  label.textContent = text;
  document.body.append(el);
  return {
    progress(p: number, t?: string) { fill.style.width = `${Math.round(p * 100)}%`; if (t) label.textContent = t; },
    close() { el.remove(); },
  };
}

// ---- start screen ----------------------------------------------------------

function showStart() {
  editor?.destroy();
  editor = null;
  app.replaceChildren();
  const el = h('div', { class: 'start' }, `
    <div class="brand">
      <div class="logo">${icons.shield}</div>
      <div><h1>Docunym</h1><p>Dokumente und Screenshots anonymisieren – direkt auf dem Handy.</p></div>
    </div>
    <div class="big-actions">
      <button class="big primary" data-a="camera">${icons.camera}<div><b>Dokument fotografieren</b><span>Kamera öffnen</span></div></button>
      <button class="big" data-a="gallery">${icons.image}<div><b>Bild oder Screenshot wählen</b><span>Aus der Galerie</span></div></button>
    </div>
    <div class="info">
      <div>${icons.wifiOff}<span>Die App hat keinen Internetzugriff. Texterkennung und Anonymisierung laufen nur auf diesem Gerät.</span></div>
      <div>${icons.shield}<span>Gespeichert wird ein neues Bild ohne Metadaten: kein Ort, kein Aufnahmedatum, kein Gerätename, zufälliger Dateiname.</span></div>
    </div>`);
  el.querySelector('[data-a=camera]')!.addEventListener('click', () => open(takePhoto));
  el.querySelector('[data-a=gallery]')!.addEventListener('click', () => open(pickImage));
  app.append(el);
}

async function open(get: () => Promise<HTMLImageElement | null>) {
  let img: HTMLImageElement | null;
  try {
    img = await get();
  } catch (e) {
    toast(`Bild konnte nicht geladen werden: ${(e as Error).message ?? e}`);
    return;
  }
  if (!img) return;
  // Copy into a canvas and drop the image element: from here on only pixels exist, no file and no metadata.
  const source = document.createElement('canvas');
  source.width = img.naturalWidth;
  source.height = img.naturalHeight;
  source.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
  img.src = '';

  const b = busy('Texterkennung wird gestartet …');
  try {
    const lines = await recognize(source, (p) => b.progress(p, `Text wird erkannt … ${Math.round(p * 100)} %`));
    b.close();
    showEditor(source, lines);
  } catch (e) {
    b.close();
    toast(`Texterkennung fehlgeschlagen: ${(e as Error).message ?? e}`, 5000);
  }
}

// ---- editor screen ---------------------------------------------------------

function showEditor(source: HTMLCanvasElement, lines: Awaited<ReturnType<typeof recognize>>) {
  saved = false;
  app.replaceChildren();
  const bar = h('div', { class: 'bar' }, `
    <button class="icon-btn" data-a="close" aria-label="Verwerfen">${icons.close}</button>
    <h2>Prüfen</h2>
    <button class="icon-btn" data-a="undo" aria-label="Rückgängig">${icons.undo}</button>`);
  const stage = h('div', { class: 'stage' }, `
    <canvas></canvas>
    <div class="zoom">
      <button data-a="zin" aria-label="Vergrößern">${icons.zoomIn}</button>
      <button data-a="zout" aria-label="Verkleinern">${icons.zoomOut}</button>
      <button data-a="fit" aria-label="Ganzes Bild">${icons.fit}</button>
    </div>`);
  const hint = h('div', { class: 'hint' }, 'Tippen: an/aus · Ziehen: abdecken · Zwei Finger: zoomen');
  const panel = h('div', { class: 'panel' }, `
    <div class="chips"></div>
    <div class="row">
      <div class="seg">
        <button data-m="black">${icons.block}Schwärzen</button>
        <button data-m="replace">${icons.text}Ersetzen</button>
      </div>
      <button class="toggle" data-a="preview">${icons.eye}Vorschau</button>
    </div>
    <div class="actions">
      <button class="act" data-a="share">${icons.share}Teilen</button>
      <button class="act primary" data-a="save">${icons.save}Speichern</button>
    </div>`);
  app.append(bar, stage, hint, panel);

  const ed = new Editor(stage.querySelector('canvas')!, source, lines);
  editor = ed;
  const q = <T extends Element = HTMLButtonElement>(s: string) => app.querySelector<T>(s)!;

  const chips = panel.querySelector<HTMLElement>('.chips')!;
  const update = () => {
    saved = false;
    const counts = ed.counts();
    chips.replaceChildren();
    for (const cat of Object.keys(CATEGORY_LABEL) as Category[]) {
      const c = counts[cat];
      const chip = h('button', { class: `chip${c.active ? '' : ' off'}`, style: `--c:${CATEGORY_COLOR[cat]}` }, `<i></i>${CATEGORY_LABEL[cat]} ${c.active}/${c.total}`);
      chip.disabled = c.total === 0;
      chip.addEventListener('click', () => ed.toggleCategory(cat));
      chips.append(chip);
    }
    const all = h('button', { class: 'link' }, 'Gesamten Text');
    all.addEventListener('click', () => ed.markAllText());
    chips.append(all);
    q('[data-a=undo]').disabled = !ed.canUndo();
    panel.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) => b.classList.toggle('on', b.dataset.m === ed.mode));
    q('[data-a=preview]').classList.toggle('on', ed.preview);
  };
  ed.onChange = update;
  update();
  if (!lines.length) toast('Kein Text erkannt. Bereiche bitte von Hand abdecken.', 4500);

  q('[data-a=undo]').addEventListener('click', () => ed.undo());
  q('[data-a=zin]').addEventListener('click', () => ed.zoom(1.5));
  q('[data-a=zout]').addEventListener('click', () => ed.zoom(1 / 1.5));
  q('[data-a=fit]').addEventListener('click', () => ed.fit());
  panel.querySelectorAll<HTMLButtonElement>('[data-m]').forEach((b) =>
    b.addEventListener('click', () => { ed.setMode(b.dataset.m as 'black' | 'replace'); if (!ed.preview) { ed.setPreview(true); } update(); }));
  q('[data-a=preview]').addEventListener('click', () => { ed.setPreview(!ed.preview); update(); });
  q('[data-a=close]').addEventListener('click', () => {
    if (saved || confirm('Bild verwerfen? Nicht gespeicherte Änderungen gehen verloren.')) {
      source.width = source.height = 0;
      showStart();
    }
  });

  const exportAnd = async (what: 'save' | 'share') => {
    const b = busy('Bild wird erstellt …');
    try {
      const { blob, name } = await ed.export();
      if (what === 'save') {
        const where = await saveImage(blob, name);
        saved = true;
        toast(`Gespeichert in ${where}`);
      } else {
        b.close();
        await shareImage(blob, name);
      }
    } catch (e) {
      toast(`Fehler: ${(e as Error).message ?? e}`, 5000);
    } finally {
      b.close();
    }
  };
  q('[data-a=save]').addEventListener('click', () => exportAnd('save'));
  q('[data-a=share]').addEventListener('click', () => exportAnd('share'));
}

clearShareCache();
showStart();
warmUp();
