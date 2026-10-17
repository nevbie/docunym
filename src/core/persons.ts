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

export class PersonRegistry {
  persons: Person[] = [];

  constructor(private store?: KeyValueStore) {
    try {
      const raw = store?.get();
      const data = raw ? JSON.parse(raw) : null;
      if (Array.isArray(data?.persons)) this.persons = data.persons;
    } catch { /* broken data: start empty */ }
  }

  private save() { this.store?.set(JSON.stringify({ persons: this.persons })); }

  private nextLabel(): string {
    const used = new Set(this.persons.map((p) => p.label));
    for (let i = 0; ; i++) { const l = `Person ${letterLabel(i)}`; if (!used.has(l)) return l; }
  }

  /** Returns the person for a written name, creating (and remembering) a new one if it is unknown. */
  assign(words: string[]): Person | null {
    const name = splitName(words);
    if (!name) return null;
    let p: Person | undefined;
    if (name.first.length) {
      // Same surname and no conflicting first name ("Anna Mayer" is not "Max Mayer").
      const same = this.persons.filter((x) => x.last.includes(name.last));
      p = same.find((x) => name.first.some((f) => x.first.includes(f))) ?? same.find((x) => x.first.length === 0);
      // A single known word might also be a first name written before ("Max" then "Max Mayer").
      p ??= this.persons.find((x) => x.first.length === 0 && x.last.length === 1 && name.first.includes(x.last[0]));
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
    return r;
  }

  rename(label: string, newLabel: string): void {
    const p = this.persons.find((x) => x.label === label);
    const n = newLabel.trim();
    if (!p || !n || this.persons.some((x) => x !== p && x.label === n)) return;
    p.label = n;
    this.save();
  }

  remove(label: string): void {
    this.persons = this.persons.filter((x) => x.label !== label);
    this.save();
  }

  clear(): void {
    this.persons = [];
    this.save();
  }
}
