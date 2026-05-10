import { describe, expect, it } from 'vitest';
import { encodePng } from '../pdf/render/png-encoder';

describe('png-encoder', () => {
  it('encodes minimum viable grayscale PNG', () => {
    const px = new Uint8Array([0, 128, 255, 64]); // 2x2 gray
    const out = encodePng(px, 2, 2, 'gray');
    // PNG signature
    expect(out[0]).toBe(0x89);
    expect(out[1]).toBe(0x50);
    expect(out[2]).toBe(0x4e);
    expect(out[3]).toBe(0x47);
    // Size > signature + IHDR + IDAT + IEND
    expect(out.length).toBeGreaterThan(8 + 12 + 12 + 12);
  });

  it('encodes 2x1 RGB without throwing', () => {
    const px = new Uint8Array([255, 0, 0, 0, 255, 0]); // red, green
    const out = encodePng(px, 2, 1, 'rgb');
    expect(out.length).toBeGreaterThan(20);
  });

  it('converts CMYK to RGB plausibly', () => {
    // C=1, M=0, Y=0, K=0 → cyan-ish (R=0, G=255, B=255)
    const px = new Uint8Array([255, 0, 0, 0]);
    const out = encodePng(px, 1, 1, 'cmyk-as-rgb');
    expect(out.length).toBeGreaterThan(20);
  });
});

describe('svg-renderer module', () => {
  it('imports without throwing', async () => {
    const mod = await import('../pdf/render/svg-renderer');
    expect(typeof mod.renderPageSvg).toBe('function');
  });
});
