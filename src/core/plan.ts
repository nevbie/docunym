// Decides what happens to every finding (per category: black bar, dummy, pseudonym or keep) and turns the
// result into simple drawing instructions. Pure logic, no canvas.
import { CATEGORY_OF, type Box, type Category, type Finding } from './detect';
import type { PersonRegistry } from './persons';

export type Action = 'black' | 'replace' | 'pseudo' | 'keep';
export type Actions = Record<Category, Action>;

export const DEFAULT_ACTIONS: Actions = { name: 'black', address: 'black', number: 'black', contact: 'black' };
export const ACTION_OPTIONS: Record<Category, Action[]> = {
  name: ['black', 'replace', 'pseudo', 'keep'],
  address: ['black', 'replace', 'keep'],
  number: ['black', 'replace', 'keep'],
  contact: ['black', 'replace', 'keep'],
};

/** Reads stored actions, falling back to the defaults for anything missing or invalid. */
export function parseActions(raw: unknown): Actions {
  const out = { ...DEFAULT_ACTIONS };
  if (raw && typeof raw === 'object') {
    for (const cat of Object.keys(out) as Category[]) {
      const a = (raw as Record<string, unknown>)[cat];
      if (typeof a === 'string' && (ACTION_OPTIONS[cat] as string[]).includes(a)) out[cat] = a as Action;
    }
  }
  return out;
}

/**
 * What is done with a finding: null = left as it is.
 * Words the user marked by hand are always covered, even when their category is set to "keep".
 */
export function actionFor(f: Finding, actions: Actions): Exclude<Action, 'keep'> | null {
  if (!f.active) return null;
  const a = actions[CATEGORY_OF[f.kind]];
  if (a === 'keep') return f.manual ? 'black' : null;
  return a;
}

/** Groups neighbouring name words of one line into written names ("Max", "Mayer" → "Max Mayer"). */
export function groupNames(findings: Finding[]): Finding[][] {
  const names = findings
    .filter((f) => CATEGORY_OF[f.kind] === 'name')
    .sort((a, b) => a.line - b.line || a.word - b.word);
  const groups: Finding[][] = [];
  for (const f of names) {
    const g = groups[groups.length - 1];
    const prev = g?.[g.length - 1];
    const joins = prev && prev.line === f.line && prev.word + 1 === f.word && prev.active === f.active
      && !/[.;:!?]$/.test(prev.text) && !(prev.text.endsWith(',') && g.length > 1);
    if (joins) g.push(f); else groups.push([f]);
  }
  return groups;
}

export type DrawItem =
  | { type: 'black'; box: Box }
  /** Cover with the paper colour, then write `text` (may be empty) at the baseline. */
  | { type: 'cover'; box: Box; text: string; x: number; baseline: number; fontSize: number; width: number };

const pad = (b: Box, f: number): Box => {
  const p = Math.max(2, (b.y1 - b.y0) * f);
  return { x0: b.x0 - p, y0: b.y0 - p, x1: b.x1 + p, y1: b.y1 + p };
};
const union = (boxes: Box[]): Box => ({
  x0: Math.min(...boxes.map((b) => b.x0)), y0: Math.min(...boxes.map((b) => b.y0)),
  x1: Math.max(...boxes.map((b) => b.x1)), y1: Math.max(...boxes.map((b) => b.y1)),
});

/** Builds the drawing instructions. `persons` assigns the pseudonyms (pass a fork for previews). */
export function planRedactions(findings: Finding[], manual: Box[], actions: Actions, persons: PersonRegistry): DrawItem[] {
  const items: DrawItem[] = [];
  const cover = (box: Box, text: string, f: Finding): DrawItem =>
    ({ type: 'cover', box: pad(box, 0.15), text, x: box.x0, baseline: f.baseline, fontSize: f.fontSize, width: box.x1 - box.x0 });

  const pseudo = new Set<Finding>();
  for (const g of groupNames(findings)) {
    if (actionFor(g[0], actions) !== 'pseudo') continue;
    const person = persons.assign(g.map((f) => f.text));
    if (!person) continue;
    g.forEach((f) => pseudo.add(f));
    const trail = /[,.;:!?]$/.exec(g[g.length - 1].text)?.[0] ?? '';
    items.push(cover(union(g.map((f) => f.bbox)), person.label + trail, g[0]));
  }
  for (const f of findings) {
    if (pseudo.has(f)) continue;
    const a = actionFor(f, actions);
    if (a === 'black' || a === 'pseudo') items.push({ type: 'black', box: pad(f.bbox, 0.18) });
    else if (a === 'replace') items.push(cover(f.bbox, f.replacement, f));
  }
  for (const b of manual) items.push({ type: 'black', box: b });
  return items;
}
