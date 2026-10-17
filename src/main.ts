import './style.css';
import { Dummies, type Category, type OcrLine } from './core/detect';
import { ACTION_OPTIONS, parseActions, type Action, type Actions } from './core/plan';
import { PersonRegistry, type KeyValueStore, type Person } from './core/persons';
import { CATEGORY_COLOR, CATEGORY_LABEL, Editor } from './editor';
import { icons } from './icons';
import { recognize, warmUp } from './ocr';
import { clearShareCache, pickImages, saveImage, shareImage, takePhoto, type ImageLoader } from './platform';

// ---- local storage (stays on this device; the app has no network access) ----

function store(key: string): KeyValueStore {
  return {
    get: () => { try { return localStorage.getItem(key); } catch { return null; } },
    set: (v) => { try { localStorage.setItem(key, v); } catch { /* full or blocked */ } },
  };
}
const settingsStore = store('docunym.settings');
const persons = new PersonRegistry(store('docunym.persons'));

function loadActions(): Actions {
  try { return parseActions(JSON.parse(settingsStore.get() ?? 'null')?.actions); } catch { return parseActions(null); }
}
let actions = loadActions();
function saveActions(a: Actions) { actions = a; settingsStore.set(JSON.stringify({ actions })); }

const ACTION_LABEL: Record<Action, string> = {
  black: 'Schwärzen', replace: 'Ersetzen', pseudo: 'Pseudonym', keep: 'Behalten',
};
const ACTION_HINT: Record<Action, string> = {
  black: 'Schwarzer Balken',
  replace: 'Erfundene Werte in passender Farbe',
  pseudo: '„Person A“, „Person B“ … – gleiche Person, gleiches Pseudonym, auch in späteren Bildern',
  keep: 'Bleibt sichtbar (von Hand markierte Wörter werden trotzdem geschwärzt)',
};

// ---- small UI helpers ------------------------------------------------------

const app = document.getElementById('app')!;
let editor: Editor | null = null;

function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Record<string, string> = {}, html = ''): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = html;
  return el;
}
const esc = (s: string) => s.replace(/[&<>"]/g, (c) => `&#${c.charCodeAt(0)};`);

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

/** Bottom sheet with a list of choices; resolves with the chosen value or null. */
function sheet<T extends string>(title: string, options: { value: T; label: string; hint?: string; on?: boolean }[]): Promise<T | null> {
  return new Promise((resolve) => {
    const el = h('div', { class: 'sheet-bg' }, `<div class="sheet"><h3></h3><div class="opts"></div></div>`);
    el.querySelector('h3')!.textContent = title;
    const opts = el.querySelector('.opts')!;
    const done = (v: T | null) => { el.remove(); resolve(v); };
    for (const o of options) {
      const b = h('button', { class: `opt${o.on ? ' on' : ''}` }, `<span class="tick">${o.on ? icons.check : ''}</span><span><b></b><small></small></span>`);
      b.querySelector('b')!.textContent = o.label;
      b.querySelector('small')!.textContent = o.hint ?? '';
      b.addEventListener('click', () => done(o.value));
      opts.append(b);
    }
    el.addEventListener('click', (e) => { if (e.target === el) done(null); });
    document.body.append(el);
  });
}

// ---- start screen ----------------------------------------------------------

function showStart() {
  editor?.destroy();
  editor = null;
  app.replaceChildren();
  const n = persons.persons.length;
  const el = h('div', { class: 'start' }, `
    <div class="brand">
      <div class="logo">${icons.shield}</div>
      <div><h1>Docunym</h1><p>Dokumente und Screenshots anonymisieren – direkt auf dem Handy.</p></div>
    </div>
    <div class="big-actions">
      <button class="big primary" data-a="camera">${icons.camera}<div><b>Dokument fotografieren</b><span>Kamera öffnen</span></div></button>
      <button class="big" data-a="gallery">${icons.image}<div><b>Bilder oder Screenshots wählen</b><span>Aus der Galerie, auch mehrere</span></div></button>
      <button class="big slim" data-a="persons">${icons.person}<div><b>Personen-Liste</b><span>${n === 1 ? '1 Pseudonym gespeichert' : `${n} Pseudonyme gespeichert`}</span></div></button>
    </div>
    <div class="info">
      <div>${icons.wifiOff}<span>Die App hat keinen Internetzugriff. Texterkennung und Anonymisierung laufen nur auf diesem Gerät.</span></div>
      <div>${icons.shield}<span>Gespeichert wird ein neues Bild ohne Metadaten: kein Ort, kein Aufnahmedatum, kein Gerätename, zufälliger Dateiname.</span></div>
    </div>`);
  el.querySelector('[data-a=camera]')!.addEventListener('click', async () => {
    try {
      const img = await takePhoto();
      if (img) startBatch([async () => img]);
    } catch (e) { toast(`Kamera: ${errText(e)}`, 5000); }
  });
  el.querySelector('[data-a=gallery]')!.addEventListener('click', async () => {
    try {
      const loaders = await pickImages();
      if (loaders.length) startBatch(loaders);
    } catch (e) { toast(`Galerie: ${errText(e)}`, 5000); }
  });
  el.querySelector('[data-a=persons]')!.addEventListener('click', showPersons);
  app.append(el);
}

const errText = (e: unknown) => String((e as Error)?.message ?? e);

// ---- person list -----------------------------------------------------------

const cap = (s: string) => s.replace(/(^|[\s-])\p{L}/gu, (m) => m.toUpperCase());
/** "Elisabeth Birkhold, auch: Frau Birkhold" – known name parts plus manually assigned spellings. */
function personNames(p: Person): string {
  const parts = [...p.first, ...p.last].map(cap).join(' ');
  const aliases = Object.entries(persons.aliases).filter(([, l]) => l === p.label).map(([k]) => cap(k));
  return aliases.length ? `${parts} · zugeordnet: ${aliases.join(', ')}` : parts;
}

function showPersons() {
  app.replaceChildren();
  const bar = h('div', { class: 'bar' }, `
    <button class="icon-btn" data-a="back" aria-label="Zurück">${icons.close}</button>
    <h2>Personen-Liste</h2>`);
  const list = h('div', { class: 'persons' });
  const render = () => {
    list.replaceChildren();
    if (!persons.persons.length) {
      list.append(h('p', { class: 'empty' }, 'Noch keine Pseudonyme. Stelle bei „Namen“ die Aktion „Pseudonym“ ein – beim Speichern merkt sich die App, welche Person welches Pseudonym hat.'));
      return;
    }
    list.append(h('p', { class: 'note' }, 'Nur auf diesem Gerät gespeichert. Gleiche Person bekommt in jedem Bild das gleiche Pseudonym.'));
    for (const p of persons.persons) {
      const names = esc(personNames(p));
      const row = h('div', { class: 'person' }, `
        <div><b>${esc(p.label)}</b><span>${names}</span></div>
        <button class="icon-btn" data-a="merge" aria-label="Zusammenführen">${icons.merge}</button>
        <button class="icon-btn" data-a="rename" aria-label="Umbenennen">${icons.pen}</button>
        <button class="icon-btn" data-a="delete" aria-label="Löschen">${icons.trash}</button>`);
      row.querySelector('[data-a=merge]')!.addEventListener('click', async () => {
        const others = persons.persons.filter((x) => x !== p);
        if (!others.length) return toast('Keine andere Person zum Zusammenführen.');
        const into = await sheet(`${p.label} ist dieselbe Person wie …`,
          others.map((x) => ({ value: x.label, label: x.label, hint: personNames(x) })));
        if (into) { persons.merge(p.label, into); render(); toast(`${p.label} gehört jetzt zu ${into}`); }
      });
      row.querySelector('[data-a=rename]')!.addEventListener('click', () => {
        const n = prompt('Neues Pseudonym:', p.label);
        if (n) { persons.rename(p.label, n); render(); }
      });
      row.querySelector('[data-a=delete]')!.addEventListener('click', () => {
        if (confirm(`${p.label} vergessen?`)) { persons.remove(p.label); render(); }
      });
      list.append(row);
    }
    const clear = h('button', { class: 'act danger' }, `${icons.trash}Alle vergessen`);
    clear.addEventListener('click', () => { if (confirm('Alle gespeicherten Personen vergessen?')) { persons.clear(); render(); } });
    list.append(clear);
  };
  render();
  bar.querySelector('[data-a=back]')!.addEventListener('click', showStart);
  app.append(bar, list);
}

// ---- batch of pictures -----------------------------------------------------

interface Batch { loaders: ImageLoader[]; index: number; saved: number; dummies: Dummies }
let batch: Batch | null = null;

function startBatch(loaders: ImageLoader[]) {
  // One Dummies for the whole batch: the same name gets the same dummy on every picture.
  batch = { loaders, index: 0, saved: 0, dummies: new Dummies() };
  openCurrent();
}

function finishBatch() {
  const b = batch;
  batch = null;
  showStart();
  if (b && b.loaders.length > 1) toast(`${b.saved} von ${b.loaders.length} Bildern gespeichert`);
}

function next() {
  if (!batch) return showStart();
  batch.index++;
  if (batch.index >= batch.loaders.length) finishBatch(); else openCurrent();
}

async function openCurrent() {
  const b = batch!;
  const total = b.loaders.length;
  const prefix = total > 1 ? `Bild ${b.index + 1} von ${total}: ` : '';
  const ui = busy(`${prefix}Bild wird geladen …`);
  let source: HTMLCanvasElement;
  try {
    const img = await b.loaders[b.index]();
    // Copy into a canvas and drop the image: from here on only pixels exist, no file and no metadata.
    source = document.createElement('canvas');
    source.width = img.naturalWidth;
    source.height = img.naturalHeight;
    source.getContext('2d', { willReadFrequently: true })!.drawImage(img, 0, 0);
    img.src = '';
  } catch (e) {
    ui.close();
    toast(`Bild konnte nicht geladen werden: ${errText(e)}`, 5000);
    return total > 1 ? next() : finishBatch();
  }
  try {
    const lines = await recognize(source, (text, p) => ui.progress(p, `${prefix}${text} … ${Math.round(p * 100)} %`));
    ui.close();
    showEditor(source, lines);
  } catch (e) {
    ui.close();
    showError(errText(e), () => openCurrent());
  }
}

function showError(text: string, retry: () => void) {
  app.replaceChildren();
  const el = h('div', { class: 'start' }, `
    <div class="error"><b>Texterkennung fehlgeschlagen</b><p></p>
    <p class="muted">Bitte einen Screenshot dieser Meldung schicken, falls es wieder passiert.</p></div>
    <div class="big-actions">
      <button class="big primary" data-a="retry">${icons.undo}<div><b>Erneut versuchen</b></div></button>
      <button class="big" data-a="back">${icons.close}<div><b>Abbrechen</b></div></button>
    </div>`);
  el.querySelector('.error p')!.textContent = text;
  el.querySelector('[data-a=retry]')!.addEventListener('click', retry);
  el.querySelector('[data-a=back]')!.addEventListener('click', finishBatch);
  app.append(el);
}

// ---- editor screen ---------------------------------------------------------

function showEditor(source: HTMLCanvasElement, lines: OcrLine[]) {
  const b = batch!;
  const total = b.loaders.length;
  const last = b.index === total - 1;
  let saved = false;
  app.replaceChildren();
  const bar = h('div', { class: 'bar' }, `
    <button class="icon-btn" data-a="close" aria-label="Abbrechen">${icons.close}</button>
    <h2>${total > 1 ? `Bild ${b.index + 1} von ${total}` : 'Prüfen'}</h2>
    <button class="icon-btn" data-a="undo" aria-label="Rückgängig">${icons.undo}</button>
    ${total > 1 ? `<button class="icon-btn" data-a="skip" aria-label="Überspringen">${icons.next}</button>` : ''}`);
  const stage = h('div', { class: 'stage' }, `
    <canvas></canvas>
    <div class="zoom">
      <button data-a="zin" aria-label="Vergrößern">${icons.zoomIn}</button>
      <button data-a="zout" aria-label="Verkleinern">${icons.zoomOut}</button>
      <button data-a="fit" aria-label="Ganzes Bild">${icons.fit}</button>
    </div>`);
  const hint = h('div', { class: 'hint' });
  const panel = h('div', { class: 'panel' }, `
    <div class="chips"></div>
    <div class="row">
      <button class="toggle" data-a="preview">${icons.eye}Vorschau</button>
      <button class="toggle" data-a="all">${icons.text}Gesamten Text</button>
    </div>
    <div class="actions">
      <button class="act" data-a="share">${icons.share}Teilen</button>
      <button class="act primary" data-a="save">${icons.save}${total > 1 && !last ? 'Speichern &amp; weiter' : 'Speichern'}</button>
    </div>`);
  app.append(bar, stage, hint, panel);

  const ed = new Editor(stage.querySelector('canvas')!, source, lines, actions, persons, b.dummies);
  editor = ed;
  const q = (s: string) => app.querySelector<HTMLButtonElement>(s)!;

  const chips = panel.querySelector<HTMLElement>('.chips')!;
  const update = () => {
    saved = false;
    const counts = ed.counts();
    chips.replaceChildren();
    for (const cat of Object.keys(CATEGORY_LABEL) as Category[]) {
      const c = counts[cat];
      const a = ed.actions[cat];
      const chip = h('button', { class: `chip${a === 'keep' ? ' off' : ''}`, style: `--c:${CATEGORY_COLOR[cat]}` },
        `<i></i><span>${CATEGORY_LABEL[cat]} · ${c.total} gefunden</span><em>${ACTION_LABEL[a]}</em>`);
      chip.addEventListener('click', async () => {
        const choice = await sheet(`${CATEGORY_LABEL[cat]}: was soll passieren?`,
          ACTION_OPTIONS[cat].map((v) => ({ value: v, label: ACTION_LABEL[v], hint: ACTION_HINT[v], on: v === ed.actions[cat] })));
        if (!choice) return;
        ed.setAction(cat, choice);
        saveActions(ed.actions); // remembered as default for the next pictures
        if (!ed.preview) { ed.setPreview(true); update(); }
      });
      chips.append(chip);
    }
    hint.textContent = ed.actions.name === 'pseudo'
      ? 'Name antippen: Person zuordnen · Ziehen: abdecken · Zwei Finger: zoomen'
      : 'Tippen: an/aus · Ziehen: abdecken · Zwei Finger: zoomen';
    q('[data-a=undo]').disabled = !ed.canUndo();
    q('[data-a=preview]').classList.toggle('on', ed.preview);
  };
  ed.onChange = update;
  ed.onPseudoTap = async (words) => {
    const written = words.join(' ').replace(/[,.;:!?]$/, '');
    ed.commitPseudonyms();
    const current = persons.assign(words)?.label;
    const choice = await sheet(`Wer ist „${written}“?`, [
      ...persons.persons.map((p) => ({ value: `p:${p.label}`, label: p.label, hint: personNames(p), on: p.label === current })),
      { value: 'new', label: 'Neue Person', hint: 'Eigenes Pseudonym für diesen Namen' },
      { value: 'keep', label: 'Nicht ersetzen', hint: 'Dieser Name bleibt sichtbar' },
    ]);
    if (!choice) return;
    if (choice === 'keep') return ed.keepName(words);
    const label = choice === 'new' ? null : choice.slice(2);
    if (label === current) return;
    const p = persons.assignTo(words, label);
    if (p) toast(`„${written}“ ist jetzt ${p.label}`);
    ed.draw();
    update();
  };
  update();
  if (!lines.length) toast('Kein Text erkannt. Bereiche bitte von Hand abdecken.', 4500);

  const leave = () => { source.width = source.height = 0; ed.destroy(); editor = null; };
  q('[data-a=undo]').addEventListener('click', () => ed.undo());
  q('[data-a=zin]').addEventListener('click', () => ed.zoom(1.5));
  q('[data-a=zout]').addEventListener('click', () => ed.zoom(1 / 1.5));
  q('[data-a=fit]').addEventListener('click', () => ed.fit());
  q('[data-a=all]').addEventListener('click', () => ed.markAllText());
  q('[data-a=preview]').addEventListener('click', () => { ed.setPreview(!ed.preview); update(); });
  q('[data-a=close]').addEventListener('click', () => {
    const msg = total > 1 ? 'Abbrechen? Die restlichen Bilder werden nicht bearbeitet.' : 'Bild verwerfen? Nicht gespeicherte Änderungen gehen verloren.';
    if (saved || confirm(msg)) { leave(); finishBatch(); }
  });
  if (total > 1) q('[data-a=skip]').addEventListener('click', () => { leave(); next(); });

  const exportAnd = async (what: 'save' | 'share') => {
    const ui = busy('Bild wird erstellt …');
    try {
      const { blob, name } = await ed.export();
      if (what === 'save') {
        const where = await saveImage(blob, name);
        b.saved++;
        ui.close();
        if (total > 1 && !last) { toast(`Gespeichert in ${where}`, 1500); leave(); next(); return; }
        if (total > 1) { leave(); finishBatch(); return; }
        saved = true;
        toast(`Gespeichert in ${where}`);
      } else {
        ui.close();
        await shareImage(blob, name);
      }
    } catch (e) {
      toast(`Fehler: ${errText(e)}`, 5000);
    } finally {
      ui.close();
    }
  };
  q('[data-a=save]').addEventListener('click', () => exportAnd('save'));
  q('[data-a=share]').addEventListener('click', () => exportAnd('share'));
}

clearShareCache();
showStart();
warmUp();
