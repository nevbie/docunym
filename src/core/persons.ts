// Pseudonyms: every real person gets a stable label ("Person A") that is remembered on the device,
// so the same person keeps the same label across pictures and sessions.
import { clean } from './detect';
import { NAME_PARTICLES } from './lists';

export interface Person {
  label: string;
  /** Lowercase first names and surnames seen for this person. */
  first: string[];
  last: string[];
}

export interface KeyValueStore { get(): string | null; set(value: string): void }

/** "A".."Z", "AA", "AB", ... */
export function letterLabel(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

/** Splits the words of one written name into first names and surname ("Müller, Anna" → surname first). */
export function splitName(words: string[]): { first: string[]; last: string } | null {
  const toks = words.map((w) => clean(w)).filter((t) => t && !NAME_PARTICLES.has(t.toLowerCase())).map((t) => t.toLowerCase());
  if (!toks.length) return null;
  if (words.length > 1 && words[0].trim().endsWith(',')) return { last: toks[0], first: toks.slice(1) };
  return { last: toks[toks.length - 1], first: toks.slice(0, -1) };
}

/** Key of a written name for manual assignments: "max mayer", "mayer". */
export function nameKey(words: string[]): string {
  const n = splitName(words);
  return n ? [...n.first, n.last].join(' ') : '';
}

export class PersonRegistry {
  persons: Person[] = [];
  /** Manual assignments: written name (nameKey) → person label. Wins over the automatic matching. */
  aliases: Record<string, string> = {};

  constructor(private store?: KeyValueStore) {
    try {
      const raw = store?.get();
      const data = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data?.persons)) this.persons = data.persons;
      if (data?.aliases && typeof data.aliases === 'object') this.aliases = data.aliases;
    } catch { /* broken data: start empty */ }
  }

  private save() { this.store?.set(JSON.stringify({ persons: this.persons, aliases: this.aliases })); }

  get(label: string): Person | undefined { return this.persons.find((x) => x.label === label); }

  private nextLabel(): string {
    const used = new Set(this.persons.map((p) => p.label));
    for (let i = 0; ; i++) { const l = `Person ${letterLabel(i)}`; if (!used.has(l)) return l; }
  }

  /** Returns the person for a written name, creating (and remembering) a new one if it is unknown. */
  assign(words: string[]): Person | null {
    const name = splitName(words);
    if (!name) return null;
    const assigned = this.get(this.aliases[nameKey(words)] ?? '');
    if (assigned) return assigned;
    let p: Person | undefined;
    if (name.first.length) {
      // Same surname and no conflicting first name ("Anna Mayer" is not "Max Mayer").
      const same = this.persons.filter((x) => x.last.includes(name.last));
      p = same.find((x) => name.first.some((f) => x.first.includes(f))) ?? same.find((x) => x.first.length === 0);
      // A single known word might also be a first name written before ("Max" then "Max Mayer").
      p ??= this.persons.find((x) => x.first.length === 0 && x.last.length === 1 && name.first.includes(x.last[0]));
      // Same first name and the surname known in any position (an earlier misread "Anna Mayer Köln").
      p ??= this.persons.find((x) => name.first.some((f) => x.first.includes(f)) && [...x.first, ...x.last].includes(name.last));
    } else {
      p = this.persons.find((x) => x.last.includes(name.last)) ?? this.persons.find((x) => x.first.includes(name.last));
    }
    if (!p) {
      p = { label: this.nextLabel(), first: [], last: [] };
      this.persons.push(p);
    }
    const add = (list: string[], v: string) => { if (!list.includes(v)) list.push(v); };
    // A lone word is stored as surname unless it already is a known first name of this person.
    if (name.first.length || !p.first.includes(name.last)) add(p.last, name.last);
    for (const f of name.first) add(p.first, f);
    // "Max" alone was stored as a surname; once "Max Mayer" is seen, move it to the first names.
    p.last = p.last.filter((l) => !p.first.includes(l) || l === name.last);
    this.save();
    return p;
  }

  /** Copy that is not saved – for previews, so names are only remembered when a picture is saved. */
  fork(): PersonRegistry {
    const r = new PersonRegistry();
    r.persons = this.persons.map((p) => ({ label: p.label, first: [...p.first], last: [...p.last] }));
    r.aliases = { ...this.aliases };
    return r;
  }

  /**
   * Manual assignment: this written name always belongs to the person `label`.
   * Without a label a new person is created for it. Returns the person.
   */
  assignTo(words: string[], label: string | null): Person | null {
    const key = nameKey(words);
    const name = splitName(words);
    if (!key || !name) return null;
    let p = label ? this.get(label) : undefined;
    // The name no longer belongs to the person it was matched to automatically; drop persons left empty.
    for (const x of this.persons) {
      // Only when the whole name matches: a lone "Schulze" must not strip "Kurt Schulze" of his surname.
      const whole = name.first.length ? name.first.every((f) => x.first.includes(f)) : x.first.length === 0;
      if (x === p || !x.last.includes(name.last) || !whole) continue;
      x.last = x.last.filter((l) => l !== name.last);
      x.first = x.first.filter((f) => !name.first.includes(f));
    }
    const aliased = new Set(Object.values(this.aliases));
    this.persons = this.persons.filter((x) => x === p || x.first.length || x.last.length || aliased.has(x.label));
    if (!p) {
      p = { label: this.nextLabel(), first: [...name.first], last: [name.last] };
      this.persons.push(p);
    }
    this.aliases[key] = p.label;
    this.save();
    return p;
  }

  /** Merges person `from` into `into` (both were the same real person). */
  merge(from: string, into: string): void {
    const a = this.get(from), b = this.get(into);
    if (!a || !b || a === b) return;
    for (const f of a.first) if (!b.first.includes(f)) b.first.push(f);
    for (const l of a.last) if (!b.last.includes(l)) b.last.push(l);
    for (const k of Object.keys(this.aliases)) if (this.aliases[k] === from) this.aliases[k] = into;
    this.persons = this.persons.filter((x) => x !== a);
    this.save();
  }

  rename(label: string, newLabel: string): void {
    const p = this.get(label);
    const n = newLabel.trim();
    if (!p || !n || this.persons.some((x) => x !== p && x.label === n)) return;
    p.label = n;
    for (const k of Object.keys(this.aliases)) if (this.aliases[k] === label) this.aliases[k] = n;
    this.save();
  }

  remove(label: string): void {
    this.persons = this.persons.filter((x) => x.label !== label);
    for (const k of Object.keys(this.aliases)) if (this.aliases[k] === label) delete this.aliases[k];
    this.save();
  }

  clear(): void {
    this.persons = [];
    this.aliases = {};
    this.save();
  }
}
