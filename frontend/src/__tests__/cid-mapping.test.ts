import { describe, expect, it } from 'vitest';
import { buildLookup } from '../pdf/fonts/cid-mappings/types';
import { getCidLookup } from '../pdf/fonts/cid-mappings/registry';

describe('CID lookup', () => {
  it('binary search finds in range', () => {
    const lookup = buildLookup({
      registry: 'Adobe',
      ordering: 'Test',
      ranges: [
        [1, 95, 0x20],
        [100, 110, 0xac00],
      ],
    });
    expect(lookup(1)).toBe(' ');
    expect(lookup(95)).toBe('~');
    expect(lookup(100)).toBe('가');
    expect(lookup(105)).toBe(String.fromCodePoint(0xac05));
    expect(lookup(96)).toBeNull();
    expect(lookup(0)).toBeNull();
  });

  it('Adobe-Korea1 BASIC bundles ASCII region', () => {
    const lookup = getCidLookup('Adobe', 'Korea1');
    expect(lookup).not.toBeNull();
    expect(lookup!(1)).toBe(' ');
    expect(lookup!(33)).toBe('@');
    expect(lookup!(95)).toBe('~');
  });

  it('returns null for unknown collection', () => {
    expect(getCidLookup('Adobe', 'Unknown999')).toBeNull();
  });
});
