// 단순 LRU 캐시 (Map 의 insertion-order 기반).
// PdfDocument 의 객체 캐시가 무제한 증가하는 것을 막는다.

export class LRUCache<K, V> {
  private map = new Map<K, V>();
  constructor(public capacity: number) {}

  get(k: K): V | undefined {
    const v = this.map.get(k);
    if (v !== undefined) {
      // refresh: most-recent으로 이동
      this.map.delete(k);
      this.map.set(k, v);
    }
    return v;
  }

  set(k: K, v: V): void {
    if (this.map.has(k)) this.map.delete(k);
    this.map.set(k, v);
    while (this.map.size > this.capacity) {
      const oldest = this.map.keys().next().value;
      if (oldest === undefined) break;
      this.map.delete(oldest);
    }
  }

  has(k: K): boolean {
    return this.map.has(k);
  }

  delete(k: K): boolean {
    return this.map.delete(k);
  }

  clear(): void {
    this.map.clear();
  }

  get size(): number {
    return this.map.size;
  }
}
