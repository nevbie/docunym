import { describe, expect, it } from 'vitest';
import { anonymousFileName, detectKinds, Dummies, estimateColors, findPersonalData, type OcrLine } from '../src/core/detect';

/** Returns the words of `line` marked as personal data, with their kind. */
function marked(line: string): string[] {
  const words = line.split(' ');
  const kinds = detectKinds([words])[0];
  return words.flatMap((w, i) => (kinds[i] ? [`${w}=${kinds[i]}`] : []));
}

describe('detectKinds', () => {
  it('finds names after salutations, skipping titles', () => {
    expect(marked('Sehr geehrte Frau Dr. Anna Maria Kessel,')).toEqual(['Anna=name', 'Maria=name', 'Kessel,=name']);
    expect(marked('Herrn Bodo Quast')).toEqual(['Bodo=name', 'Quast=name']);
  });

  it('finds names after labels', () => {
    expect(marked('Name: Quast, Bodo')).toEqual(['Quast,=name', 'Bodo=name']);
    expect(marked('Patientin Erna Kowalczyk geb. Lindqvist')).toEqual(['Erna=name', 'Kowalczyk=name', 'Lindqvist=name']);
  });

  it('does not treat lowercase labels in running text as triggers', () => {
    expect(marked('der kunde Bescheid')).toEqual([]);
  });

  it('finds known first names with their surname, also "Surname, First"', () => {
    expect(marked('Unterlagen von Julia Brettschneider erhalten')).toEqual(['Julia=name', 'Brettschneider=name']);
    expect(marked('Brettschneider, Julia')).toEqual(['Brettschneider,=name', 'Julia=name']);
    expect(marked('mit Müller besprochen')).toEqual(['Müller=name']);
  });

  it('marks every word with a digit as number', () => {
    expect(marked('IBAN DE89 3704 0044 0532 0130 00')).toEqual([
      'DE89=number', '3704=number', '0044=number', '0532=number', '0130=number', '00=number',
    ]);
    expect(marked('Geburtsdatum 12.03.1985')).toEqual(['12.03.1985=number']);
  });

  it('finds streets', () => {
    expect(marked('Hauptstraße 12')).toEqual(['Hauptstraße=street', '12=street']);
    expect(marked('Berliner Straße 5a')).toEqual(['Berliner=street', 'Straße=street', '5a=street']);
    expect(marked('Am Mühlbach 3')).toEqual(['Am=street', 'Mühlbach=street', '3=street']);
    expect(marked('Karl-Marx-Allee 90')).toEqual(['Karl-Marx-Allee=street', '90=street']);
    expect(marked('Lindenweg 7')).toEqual(['Lindenweg=street', '7=street']);
    expect(marked('Postfach 4711, 34117 Kassel')).toEqual(['Postfach=street', '4711,=street', '34117=city', 'Kassel=city']);
    // weak suffix without house number is not a street
    expect(marked('Der Weg war weit')).toEqual([]);
  });

  it('finds the city after a postcode', () => {
    expect(marked('60311 Frankfurt am Main')).toEqual(['60311=city', 'Frankfurt=city', 'am=city', 'Main=city']);
    expect(marked('D-80331 München, Deutschland')).toEqual(['D-80331=city', 'München,=city']);
    // a lone five-digit number is just a number
    expect(marked('Betrag 12345 euro')).toEqual(['12345=number']);
  });

  it('finds e-mail addresses and web addresses', () => {
    expect(marked('Mail: bodo.quast@example.org')).toEqual(['bodo.quast@example.org=email']);
    expect(marked('www.quast-bau.de')).toEqual(['www.quast-bau.de=web']);
  });
});

describe('Dummies', () => {
  it('replaces digits but keeps the format', () => {
    const d = new Dummies(1);
    const out = d.replace('12.03.1985', 'number');
    const [day, month, year] = out.split('.').map(Number);
    expect(day).toBeGreaterThanOrEqual(1); expect(day).toBeLessThanOrEqual(28);
    expect(month).toBeGreaterThanOrEqual(1); expect(month).toBeLessThanOrEqual(12);
    expect(year).toBeGreaterThanOrEqual(1950); expect(year).toBeLessThan(2026);
    expect(out).toMatch(/^\d\d\.\d\d\.\d{4}$/);
    expect(out).not.toBe('12.03.1985');
    expect(d.replace('DE89', 'number')).toMatch(/^DE[1-9]\d$/);
    expect(d.replace('1.284,56', 'number')).toMatch(/^[1-9]\.\d{3},\d{2}$/);
  });

  it('keeps punctuation and replaces the same name consistently', () => {
    const d = new Dummies(2);
    const a = d.replace('Brettschneider,', 'name');
    expect(a.endsWith(',')).toBe(true);
    expect(d.replace('Brettschneider', 'name')).toBe(a.slice(0, -1));
    expect(d.replace('von', 'name')).toBe('von');
  });

  it('keeps generic street words and upper case', () => {
    const d = new Dummies(3);
    expect(d.replace('Straße', 'street')).toBe('Straße');
    expect(d.replace('MÜLLER', 'name')).toBe(d.replace('MÜLLER', 'name').toUpperCase());
  });
});

describe('findPersonalData', () => {
  it('returns boxes for the marked words', () => {
    const box = (x: number) => ({ x0: x, y0: 0, x1: x + 10, y1: 10 });
    const lines: OcrLine[] = [{ bbox: box(0), words: ['Herr', 'Bodo', 'Quast'].map((text, i) => ({ text, bbox: box(i * 20) })) }];
    const f = findPersonalData(lines, new Dummies(4));
    expect(f.map((x) => x.text)).toEqual(['Bodo', 'Quast']);
    expect(f[0].bbox).toEqual(box(20));
    expect(f.every((x) => x.active && x.replacement !== x.text)).toBe(true);
  });

  it('replaces a multi-word city by one dummy city', () => {
    const box = (x: number) => ({ x0: x, y0: 0, x1: x + 10, y1: 10 });
    const lines: OcrLine[] = [{ bbox: box(0), words: ['60311', 'Frankfurt', 'am', 'Main'].map((text, i) => ({ text, bbox: box(i * 20) })) }];
    const f = findPersonalData(lines, new Dummies(5));
    expect(f.map((x) => x.replacement !== '')).toEqual([true, true, false, false]);
    expect(f[0].replacement).toMatch(/^[1-9]\d{4}$/);
  });
});

describe('estimateColors', () => {
  it('finds white paper and dark ink', () => {
    const w = 40, h = 20;
    const data = new Uint8ClampedArray(w * h * 4).fill(250);
    for (let y = 8; y < 12; y++) for (let x = 12; x < 28; x++) { const i = (y * w + x) * 4; data[i] = data[i + 1] = data[i + 2] = 30; }
    const { bg, fg } = estimateColors(data, w, h, { x0: 10, y0: 6, x1: 30, y1: 14 });
    expect(bg).toEqual([250, 250, 250]);
    expect(fg).toEqual([30, 30, 30]);
  });
});

describe('anonymousFileName', () => {
  it('contains no date', () => {
    expect(anonymousFileName()).toMatch(/^anonym-[0-9a-z]{12}\.jpg$/);
  });
});
