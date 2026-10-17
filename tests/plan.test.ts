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
