import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseSeed } from '../../src/scheduling/domain/seed.schema';

const advisor = (availability: unknown[], id = 'ia-1') => ({ advisors: [{ id, name: 'Test', availability }] });

describe('parseSeed', () => {
  it('accepts the provided seed file', () => {
    const raw = JSON.parse(readFileSync(join(__dirname, '../../data/seed.json'), 'utf8'));
    const advisors = parseSeed(raw);
    expect(advisors.map((a) => [a.id, a.windows.length])).toEqual([
      ['ia-001', 9],
      ['ia-002', 11],
    ]);
    expect(advisors[0].windows[0].start).toEqual(new Date('2025-03-10T09:00:00Z'));
  });

  it('sorts windows by start time', () => {
    const [a] = parseSeed(
      advisor([
        { start: '2025-03-11T09:00:00Z', end: '2025-03-11T10:00:00Z' },
        { start: '2025-03-10T09:00:00Z', end: '2025-03-10T10:00:00Z' },
      ]),
    );
    expect(a.windows[0].start).toEqual(new Date('2025-03-10T09:00:00Z'));
  });

  it.each([
    ['a window that ends before it starts', advisor([{ start: '2025-03-10T10:00:00Z', end: '2025-03-10T09:00:00Z' }])],
    ['a zero-length window', advisor([{ start: '2025-03-10T10:00:00Z', end: '2025-03-10T10:00:00Z' }])],
    ['a date that is not ISO 8601', advisor([{ start: '10/03/2025 09:00', end: '2025-03-10T10:00:00Z' }])],
    ['a missing end', advisor([{ start: '2025-03-10T09:00:00Z' }])],
    [
      'overlapping windows',
      advisor([
        { start: '2025-03-10T09:00:00Z', end: '2025-03-10T10:00:00Z' },
        { start: '2025-03-10T09:30:00Z', end: '2025-03-10T10:30:00Z' },
      ]),
    ],
    ['an empty advisor id', advisor([], '')],
    ['a missing advisors list', {}],
    [
      'duplicate advisor ids',
      { advisors: [advisor([]).advisors[0], advisor([]).advisors[0]] },
    ],
  ])('rejects %s', (_name, raw) => {
    expect(() => parseSeed(raw)).toThrow();
  });
});
