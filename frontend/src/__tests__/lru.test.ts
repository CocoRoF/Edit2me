import { describe, expect, it } from 'vitest';
import { LRUCache } from '../pdf/core/lru';

describe('LRUCache', () => {
  it('returns undefined for missing keys', () => {
    const c = new LRUCache<string, number>(3);
    expect(c.get('a')).toBeUndefined();
  });

  it('stores and refreshes on hit', () => {
    const c = new LRUCache<string, number>(2);
    c.set('a', 1);
    c.set('b', 2);
    // 'a' refreshed
    expect(c.get('a')).toBe(1);
    c.set('c', 3); // 'b'가 LRU로 evicted
    expect(c.get('b')).toBeUndefined();
    expect(c.get('a')).toBe(1);
    expect(c.get('c')).toBe(3);
  });

  it('respects capacity strictly', () => {
    const c = new LRUCache<number, number>(3);
    for (let i = 0; i < 10; i += 1) c.set(i, i * 10);
    expect(c.size).toBe(3);
    expect(c.get(7)).toBe(70);
    expect(c.get(8)).toBe(80);
    expect(c.get(9)).toBe(90);
    expect(c.get(0)).toBeUndefined();
  });

  it('overwrites existing key without growing', () => {
    const c = new LRUCache<string, number>(3);
    c.set('a', 1);
    c.set('a', 2);
    c.set('a', 3);
    expect(c.size).toBe(1);
    expect(c.get('a')).toBe(3);
  });
});
