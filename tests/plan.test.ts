import { describe, expect, it } from 'vitest';
import { Dummies, findPersonalData, manualFinding, type OcrLine } from '../src/core/detect';
import { DEFAULT_ACTIONS, groupNames, parseActions, planRedactions, type Actions } from '../src/core/plan';
import { letterLabel, PersonRegistry, splitName } from '../src/core/persons';

const box = (x: number, y = 0) => ({ x0: x, y0: y, x1: x + 10, y1: y + 10 });
const line = (text: string, y = 0): OcrLine => ({ bbox: box(0, y), words: text.split(' ').map((t, i) => ({ text: t, bbox: box(i * 20, y) })) });

describe('PersonRegistry', () => {
  it('labels A..Z, AA', () => {
    expect([0, 1, 25, 26, 27].map(letterLabel)).toEqual(['A', 'B', 'Z', 'AA', 'AB']);
  });

  it('splits names, also "Surname, First"', () => {
    expect(splitName(['Max', 'von', 'Mayer'])).toEqual({ first: ['max'], last: 'mayer' });
    expect(splitName(['Mayer,', 'Max'])).toEqual({ first: ['max'], last: 'mayer' });
  });

  it('keeps the same person across spellings and remembers them', () => {
    let stored: string | null = null;
    const store = { get: () => stored, set: (v: string) => { stored = v; } };
    const r = new PersonRegistry(store);
    expect(r.assign(['Max', 'Mayer'])!.label).toBe('Person A');
    expect(r.assign(['Mayer'])!.label).toBe('Person A');
    expect(r.assign(['Mayer,', 'Max'])!.label).toBe('Person A');
    expect(r.assign(['Anna', 'Mayer'])!.label).toBe('Person B');
    expect(r.assign(['Bodo', 'Quast'])!.label).toBe('Person C');
    // reloaded from storage
    const again = new PersonRegistry(store);
    expect(again.assign(['Bodo', 'Quast'])!.label).toBe('Person C');
    expect(again.assign(['Lisa', 'Neu'])!.label).toBe('Person D');
  });

  it('connects a lone first name with the full name seen later', () => {
    const r = new PersonRegistry();
    expect(r.assign(['Max'])!.label).toBe('Person A');
    expect(r.assign(['Max', 'Mayer'])!.label).toBe('Person A');
    expect(r.persons[0]).toEqual({ label: 'Person A', first: ['max'], last: ['mayer'] });
  });

  it('a fork does not change the stored list', () => {
    const r = new PersonRegistry();
    r.assign(['Max', 'Mayer']);
    const f = r.fork();
    f.assign(['Bodo', 'Quast']);
    expect(r.persons.length).toBe(1);
  });

  it('can rename and forget', () => {
    const r = new PersonRegistry();
    r.assign(['Max', 'Mayer']);
    r.rename('Person A', 'Kläger');
    expect(r.assign(['Mayer'])!.label).toBe('Kläger');
    r.clear();
    expect(r.persons).toEqual([]);
  });
});

describe('actions', () => {
  it('parses stored actions and ignores invalid ones', () => {
    expect(parseActions({ name: 'pseudo', number: 'keep', address: 'pseudo', x: 1 }))
      .toEqual({ name: 'pseudo', address: 'black', number: 'keep', contact: 'black' });
    expect(parseActions(null)).toEqual(DEFAULT_ACTIONS);
  });
});

describe('planRedactions', () => {
  const lines = [line('Herr Max Mayer'), line('Hauptstraße 12', 20), line('Kundennummer 4711', 40)];
  const actions: Actions = { name: 'pseudo', address: 'black', number: 'keep', contact: 'black' };

  it('groups neighbouring name words', () => {
    const f = findPersonalData(lines, new Dummies(1));
    expect(groupNames(f).map((g) => g.map((x) => x.text))).toEqual([['Max', 'Mayer']]);
  });

  it('pseudonymises names, blacks out addresses and keeps numbers', () => {
    const f = findPersonalData(lines, new Dummies(1));
    const items = planRedactions(f, [], actions, new PersonRegistry());
    const covers = items.filter((i) => i.type === 'cover');
    expect(covers.map((i) => i.type === 'cover' && i.text)).toEqual(['Person A']);
    // one cover for the whole name
    expect(covers[0].box.x0).toBeLessThan(20);
    expect(covers[0].box.x1).toBeGreaterThan(50);
    // street and house number are black (address), the customer number is kept
    expect(items.filter((i) => i.type === 'black').length).toBe(2);
  });

  it('covers words marked by hand even if their category is kept', () => {
    const f = [...findPersonalData(lines, new Dummies(1)), manualFinding(lines, 2, 1, new Dummies(1))];
    // "4711" is now marked twice (detected + by hand): the manual one is drawn black
    const items = planRedactions(f, [], actions, new PersonRegistry());
    expect(items.filter((i) => i.type === 'black').length).toBe(3);
  });
});

describe('PersonRegistry: one person, one pseudonym', () => {
  it('"Berta Müller" and "Frau Müller" are the same person, in either order', () => {
    const r = new PersonRegistry();
    expect(r.assign(['Müller'])!.label).toBe('Person A');
    expect(r.assign(['Berta', 'Müller'])!.label).toBe('Person A');
    const r2 = new PersonRegistry();
    expect(r2.assign(['Berta', 'Müller'])!.label).toBe('Person A');
    expect(r2.assign(['Müller,'])!.label).toBe('Person A');
  });

  it('finds a person whose name was stored with an extra word', () => {
    const r = new PersonRegistry();
    r.persons = [{ label: 'Person B', first: ['elisabeth', 'birkhold'], last: ['nürnberg'] }];
    expect(r.assign(['Elisabeth', 'Birkhold'])!.label).toBe('Person B');
  });

  it('manual assignment wins and survives reloading', () => {
    let stored: string | null = null;
    const store = { get: () => stored, set: (v: string) => { stored = v; } };
    const r = new PersonRegistry(store);
    r.assign(['Berta', 'Müller']);
    r.assign(['Kurt', 'Schulze']);
    r.assignTo(['Frau', 'Schulze'].slice(1), 'Person A'); // "Schulze" here means Berta
    expect(new PersonRegistry(store).assign(['Schulze'])!.label).toBe('Person A');
    expect(new PersonRegistry(store).assign(['Kurt', 'Schulze'])!.label).toBe('Person B');
    // new person on demand
    expect(r.assignTo(['Hans', 'Muster'], null)!.label).toBe('Person C');
  });

  it('merges two persons', () => {
    const r = new PersonRegistry();
    r.assign(['Elisabeth', 'Birkhold']);
    r.assign(['Lisa', 'B.']);
    r.merge('Person B', 'Person A');
    expect(r.persons.map((p) => p.label)).toEqual(['Person A']);
    expect(r.assign(['Lisa'])!.label).toBe('Person A');
  });
});

describe('name detection limits', () => {
  it('does not take the word after the surname or document words', async () => {
    const { detectKinds } = await import('../src/core/detect');
    const m = (s: string) => { const w = s.split(' '); const k = detectKinds([w])[0]; return w.filter((_, i) => k[i] === 'name'); };
    expect(m('Elisabeth Birkhold Nürnberg')).toEqual(['Elisabeth', 'Birkhold']);
    expect(m('Frau Berta Kowalczyk')).toEqual(['Berta', 'Kowalczyk']);
    expect(m('Frau Anna Maria Kowalczyk')).toEqual(['Anna', 'Maria', 'Kowalczyk']);
    expect(m('Name: E E-Mail')).toEqual([]);
    expect(m('Kontakt E-Mail Telefon')).toEqual([]);
  });
});

describe('manual assignment cleanup', () => {
  it('removes a person that only existed for the reassigned name', () => {
    const r = new PersonRegistry();
    r.assign(['Sabine', 'Brettschneider']);
    r.assign(['Thomas', 'Quast']);
    r.assignTo(['Thomas', 'Quast'], 'Person A');
    expect(r.persons.map((p) => p.label)).toEqual(['Person A']);
    expect(r.assign(['Thomas', 'Quast'])!.label).toBe('Person A');
  });
});
