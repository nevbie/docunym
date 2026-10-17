// Finds personal data in OCR output (names, addresses, numbers, contact data) and creates dummy replacements.
// Pure logic – no canvas, no Tesseract – so it can be unit tested.
import {
  CITY_PARTICLES, FAKE_CITY, FAKE_FIRST, FAKE_LAST, FAKE_STREET, FAKE_STREET_PART, FIRST_NAMES, LAST_NAMES,
  NAME_LABELS, NAME_PARTICLES, NAME_SALUTATIONS, STREET_GENERIC, STREET_PREPOSITIONS, STREET_STRONG, STREET_WEAK, TITLES,
} from './lists';

export interface Box { x0: number; y0: number; x1: number; y1: number }
export interface OcrWord { text: string; bbox: Box }
/** `baseline` (left/right point) and `fontSize` come from Tesseract and are used to place dummy text. */
export interface OcrLine { words: OcrWord[]; bbox: Box; baseline?: Box; fontSize?: number }

export type Kind = 'name' | 'street' | 'city' | 'number' | 'email' | 'web' | 'other';
export type Category = 'name' | 'address' | 'number' | 'contact';
export const CATEGORY_OF: Record<Kind, Category> = {
  name: 'name', street: 'address', city: 'address', number: 'number', email: 'contact', web: 'contact', other: 'name',
};

export interface Finding {
  line: number;
  word: number;
  kind: Kind;
  text: string;
  bbox: Box;
  /** Baseline y and font size in pixels for drawing the replacement. */
  baseline: number;
  fontSize: number;
  replacement: string;
  active: boolean;
  /** Marked by the user (tapped), not by the detection. */
  manual?: boolean;
}

/** Word without surrounding punctuation. */
export function clean(text: string): string {
  return text.replace(/^[^\p{L}\p{N}@]+|[^\p{L}\p{N}]+$/gu, '');
}
const isCap = (s: string) => /^\p{Lu}/u.test(s);
const hasDigit = (s: string) => /\d/.test(s);
const HOUSE_NO = /^\d{1,3}\s?[a-zA-Z]?(-\d{1,3}[a-zA-Z]?)?[,.;]?$/;
const PLZ = /^((D|A|CH)-)?\d{4,5}$/;

export function classifyWord(text: string): Kind | null {
  const c = clean(text);
  if (!c) return null;
  if (/\S+@\S+\.\S+/.test(text)) return 'email';
  if (/^(https?:\/\/|www\.)/i.test(text) || /^[\w-]+(\.[\w-]+)*\.(de|com|org|net|at|ch|eu|info|io)(\/\S*)?$/i.test(c)) return 'web';
  if (hasDigit(c)) return 'number';
  return null;
}

function isNameWord(c: string): boolean {
  return c.split('-').some((p) => FIRST_NAMES.has(p.toLowerCase()) || LAST_NAMES.has(p.toLowerCase()));
}

/** Marks every word of each line with the kind of personal data it contains (or leaves it unmarked). */
export function detectKinds(lines: string[][]): (Kind | null)[][] {
  return lines.map((words) => {
    const raw = words;
    const c = raw.map(clean);
    const lc = c.map((w) => w.toLowerCase());
    const kinds: (Kind | null)[] = raw.map((w) => classifyWord(w));
    const mark = (i: number, k: Kind) => { if (i >= 0 && i < raw.length && c[i] && !kinds[i]) kinds[i] = k; };
    const markName = (i: number) => mark(i, 'name');

    // Names after salutations ("Frau Dr. Anna Müller") and labels ("Name: Müller, Anna").
    for (let i = 0; i < raw.length; i++) {
      const salutation = NAME_SALUTATIONS.has(lc[i]);
      const label = NAME_LABELS.has(lc[i]);
      if (!salutation && !label) continue;
      // A label in running text ("der Kunde hat") is only a trigger when it is capitalised.
      if (label && !isCap(c[i])) continue;
      let j = i + 1;
      while (j < raw.length && TITLES.has(lc[j])) j++;
      let taken = 0;
      while (j < raw.length && taken < 3) {
        if (!c[j] || kinds[j]) break;
        if (NAME_PARTICLES.has(lc[j]) && j + 1 < raw.length && isCap(c[j + 1])) { markName(j); j++; continue; }
        if (!isCap(c[j]) || NAME_LABELS.has(lc[j]) || NAME_SALUTATIONS.has(lc[j])) break;
        markName(j);
        taken++;
        if (salutation && /[,.;:!?]$/.test(raw[j])) break;
        j++;
      }
    }

    // Known first and last names, including the surrounding parts of the full name.
    for (let i = 0; i < raw.length; i++) {
      if (!isCap(c[i]) || !isNameWord(c[i])) continue;
      const isFirst = c[i].split('-').some((p) => FIRST_NAMES.has(p.toLowerCase()));
      markName(i);
      if (isFirst) {
        // "Anna Maria Müller", "Anna von Berg"
        for (let j = i + 1, n = 0; j < raw.length && n < 2; j++) {
          if (/[,.;:]$/.test(raw[j - 1])) break;
          if (NAME_PARTICLES.has(lc[j]) && j + 1 < raw.length && isCap(c[j + 1])) { markName(j); continue; }
          if (!isCap(c[j]) || kinds[j]) break;
          markName(j);
          n++;
        }
        // "Müller, Anna"
        if (i > 0 && raw[i - 1].endsWith(',') && isCap(c[i - 1])) markName(i - 1);
      }
    }

    // Streets.
    for (let i = 0; i < raw.length; i++) {
      if (!c[i] || !isCap(c[i])) continue;
      const nextIsNo = i + 1 < raw.length && HOUSE_NO.test(raw[i + 1]);
      const strong = STREET_STRONG.test(c[i]) || STREET_STRONG.test(raw[i]);
      const weak = STREET_WEAK.test(c[i]) && c[i].length > 4;
      if (!(strong || (weak && nextIsNo))) continue;
      if (kinds[i] === 'name') kinds[i] = null; // "Karl-Marx-Allee" contains a first name
      mark(i, 'street');
      if (nextIsNo) kinds[i + 1] = 'street'; // the house number belongs to the address
      // "Berliner Straße", "Am Alten Markt", "Karl-Marx-Allee"
      if (STREET_GENERIC.has(lc[i]) || raw[i - 1]?.endsWith('-')) {
        let j = i - 1;
        while (j >= 0 && j >= i - 3 && (isCap(c[j]) || STREET_PREPOSITIONS.has(lc[j]))) {
          mark(j, 'street');
          if (STREET_PREPOSITIONS.has(lc[j]) && !isCap(c[j - 1] ?? '')) break;
          j--;
        }
      } else if (i > 0 && STREET_PREPOSITIONS.has(lc[i - 1])) {
        mark(i - 1, 'street');
      }
    }
    // "Am Mühlbach 12", "Im Winkel 3a"
    for (let i = 0; i + 2 < raw.length; i++) {
      if (STREET_PREPOSITIONS.has(lc[i]) && isCap(c[i]) && isCap(c[i + 1]) && HOUSE_NO.test(raw[i + 2]) && i + 3 >= raw.length) {
        mark(i, 'street');
        mark(i + 1, 'street');
        kinds[i + 2] = 'street';
      }
    }
    // "Postfach 4711"
    for (let i = 0; i + 1 < raw.length; i++) {
      if (lc[i] === 'postfach' && hasDigit(raw[i + 1])) { kinds[i] = 'street'; kinds[i + 1] = 'street'; }
    }

    // Cities after a postcode: "12345 Frankfurt am Main".
    for (let i = 0; i < raw.length; i++) {
      if (!PLZ.test(c[i]) && !PLZ.test(raw[i].replace(/[,;]$/, ''))) continue;
      let n = 0;
      for (let j = i + 1; j < raw.length && n < 4; j++, n++) {
        if (isCap(c[j]) || (n > 0 && CITY_PARTICLES.has(lc[j].replace(/\.$/, '')) && j + 1 < raw.length) || /^\(.+\)$/.test(raw[j])) {
          kinds[j] = kinds[j] === 'name' || !kinds[j] ? 'city' : kinds[j];
        } else break;
        if (/[,;]$/.test(raw[j])) break;
      }
      if (n > 0 || kinds[i + 1] === 'city') kinds[i] = 'city'; // the postcode belongs to the address
    }
    return kinds;
  });
}

/** Small seeded PRNG so a picture always gets the same dummies. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Creates consistent dummy values: the same original text always gets the same replacement. */
export class Dummies {
  private rand: () => number;
  private memo = new Map<string, string>();
  constructor(seed = Date.now()) { this.rand = rng(seed); }

  private pick<T>(list: T[]): T { return list[Math.floor(this.rand() * list.length)]; }

  digits(text: string): string {
    return text.replace(/\d/g, (d, i: number) => {
      const first = i === 0 || !/\d/.test(text[i - 1]);
      if (first && d !== '0') return String(1 + Math.floor(this.rand() * 9));
      return String(Math.floor(this.rand() * 10));
    });
  }

  replace(text: string, kind: Kind): string {
    const key = `${kind}:${clean(text).toLowerCase()}`;
    const m = /^([^\p{L}\p{N}@]*)(.*?)([^\p{L}\p{N}]*)$/u.exec(text)!;
    const [, pre, core, post] = m;
    let out = this.memo.get(key);
    if (out === undefined) {
      out = this.make(core, kind);
      this.memo.set(key, out);
    }
    if (core === core.toUpperCase() && core !== core.toLowerCase() && kind !== 'number') out = out.toUpperCase();
    return pre + out + post;
  }

  private make(core: string, kind: Kind): string {
    switch (kind) {
      case 'number': {
        // Dates stay valid dates: "12.03.1985" -> "07.11.1962"
        const date = /^(\d{1,2})\.(\d{1,2})\.(\d{2}|\d{4})$/.exec(core);
        if (date) {
          const two = (n: number, len: number) => String(n).padStart(len, '0');
          const day = two(1 + Math.floor(this.rand() * 28), date[1].length);
          const month = two(1 + Math.floor(this.rand() * 12), date[2].length);
          const year = String(1950 + Math.floor(this.rand() * 76)).slice(-date[3].length);
          return `${day}.${month}.${year}`;
        }
        return this.digits(core);
      }
      case 'email': return `${this.pick(FAKE_FIRST)}.${this.pick(FAKE_LAST)}@beispiel.de`.toLowerCase();
      case 'web': return 'www.beispiel.de';
      case 'city':
        if (hasDigit(core)) return this.digits(core);
        return /^\p{Ll}/u.test(core) ? core : this.pick(FAKE_CITY);
      case 'street': {
        if (hasDigit(core)) return this.digits(core);
        const lc = core.toLowerCase().replace(/\.$/, '');
        if (STREET_GENERIC.has(lc)) return core;
        if (STREET_PREPOSITIONS.has(lc)) return core;
        if (STREET_STRONG.test(core) || STREET_WEAK.test(core)) return this.pick(FAKE_STREET);
        return this.pick(FAKE_STREET_PART) + (core.endsWith('-') ? '-' : 'er');
      }
      case 'name':
      case 'other': {
        if (/^\p{Ll}/u.test(core)) return core; // particles like "von"
        const first = core.split('-').some((p) => FIRST_NAMES.has(p.toLowerCase()));
        return this.pick(first ? FAKE_FIRST : FAKE_LAST);
      }
    }
  }
}

/** Runs the detection on OCR lines and returns one finding per marked word. */
export function findPersonalData(lines: OcrLine[], dummies = new Dummies()): Finding[] {
  const kinds = detectKinds(lines.map((l) => l.words.map((w) => w.text)));
  const out: Finding[] = [];
  lines.forEach((line, li) => line.words.forEach((w, wi) => {
    const kind = kinds[li][wi];
    if (!kind) return;
    // A multi-word city ("Frankfurt am Main") becomes one dummy city.
    const prevCity = kinds[li][wi - 1] === 'city' && !hasDigit(line.words[wi - 1].text);
    const replacement = kind === 'city' && prevCity && !hasDigit(w.text) ? '' : dummies.replace(w.text, kind);
    out.push({ line: li, word: wi, kind, text: w.text, bbox: w.bbox, ...textPlacement(line, w.bbox), replacement, active: true });
  }));
  return out;
}

/** Where to write a dummy for a word: on the line's baseline, in the line's font size. */
export function textPlacement(line: OcrLine, b: Box): { baseline: number; fontSize: number } {
  const lh = line.bbox.y1 - line.bbox.y0;
  const fontSize = line.fontSize && line.fontSize > 4 ? line.fontSize : lh * 0.8;
  let baseline = line.bbox.y1 - lh * 0.2;
  const bl = line.baseline;
  if (bl && bl.x1 !== bl.x0) {
    const t = ((b.x0 + b.x1) / 2 - bl.x0) / (bl.x1 - bl.x0);
    const y = bl.y0 + (bl.y1 - bl.y0) * t;
    if (y > line.bbox.y0 && y <= line.bbox.y1 + 1) baseline = y;
  }
  return { baseline, fontSize };
}

/** Finding for a word the user tapped that the detection missed. */
export function manualFinding(lines: OcrLine[], li: number, wi: number, dummies: Dummies): Finding {
  const w = lines[li].words[wi];
  const kind = classifyWord(w.text) ?? 'other';
  return { line: li, word: wi, kind, text: w.text, bbox: w.bbox, ...textPlacement(lines[li], w.bbox), replacement: dummies.replace(w.text, kind), active: true, manual: true };
}

export type RGB = [number, number, number];

/**
 * Estimates paper (background) and ink colour around a box, so a replacement blends in.
 * Background: median of a ring of pixels just outside the box. Ink: average of the pixels inside
 * that differ most from the background.
 */
export function estimateColors(data: ArrayLike<number>, width: number, height: number, b: Box): { bg: RGB; fg: RGB } {
  const pad = Math.max(2, Math.round((b.y1 - b.y0) * 0.25));
  const x0 = Math.max(0, Math.floor(b.x0) - pad), x1 = Math.min(width - 1, Math.ceil(b.x1) + pad);
  const y0 = Math.max(0, Math.floor(b.y0) - pad), y1 = Math.min(height - 1, Math.ceil(b.y1) + pad);
  const ring: RGB[] = [];
  const px = (x: number, y: number): RGB => { const i = (y * width + x) * 4; return [data[i], data[i + 1], data[i + 2]]; };
  const step = Math.max(1, Math.round((x1 - x0 + y1 - y0) / 200));
  for (let x = x0; x <= x1; x += step) { ring.push(px(x, y0), px(x, y1)); }
  for (let y = y0; y <= y1; y += step) { ring.push(px(x0, y), px(x1, y)); }
  const median = (k: 0 | 1 | 2) => { const v = ring.map((p) => p[k]).sort((a, b2) => a - b2); return v[v.length >> 1] ?? 255; };
  const bg: RGB = [median(0), median(1), median(2)];
  const inner: { d: number; p: RGB }[] = [];
  const istep = Math.max(1, Math.round(Math.sqrt(((b.x1 - b.x0) * (b.y1 - b.y0)) / 2000)));
  for (let y = Math.max(0, Math.floor(b.y0)); y < Math.min(height, Math.ceil(b.y1)); y += istep) {
    for (let x = Math.max(0, Math.floor(b.x0)); x < Math.min(width, Math.ceil(b.x1)); x += istep) {
      const p = px(x, y);
      inner.push({ d: Math.abs(p[0] - bg[0]) + Math.abs(p[1] - bg[1]) + Math.abs(p[2] - bg[2]), p });
    }
  }
  inner.sort((a, b2) => b2.d - a.d);
  const top = inner.slice(0, Math.max(1, Math.round(inner.length * 0.12)));
  let fg: RGB;
  if (!top.length || top[0].d < 60) {
    const lum = bg[0] * 0.3 + bg[1] * 0.59 + bg[2] * 0.11;
    fg = lum > 128 ? [20, 20, 20] : [235, 235, 235];
  } else {
    const s = top.reduce((a, t) => [a[0] + t.p[0], a[1] + t.p[1], a[2] + t.p[2]], [0, 0, 0]);
    fg = [Math.round(s[0] / top.length), Math.round(s[1] / top.length), Math.round(s[2] / top.length)];
  }
  return { bg, fg };
}

/** Random file name without date, device or source information. */
export function anonymousFileName(rand: () => number = Math.random): string {
  let s = '';
  for (let i = 0; i < 12; i++) s += '0123456789abcdefghijklmnopqrstuvwxyz'[Math.floor(rand() * 36)];
  return `anonym-${s}.jpg`;
}
