import { describe, expect, it } from 'vitest';
import { LatencyWindow, percentile } from './latency';

describe('percentile', () => {
  it('uses the nearest-rank method', () => {
    const sorted = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(sorted, 50)).toBe(50);
    expect(percentile(sorted, 95)).toBe(100);
    expect(percentile(sorted, 0)).toBe(10);
    expect(percentile([], 50)).toBeNull();
  });
});

describe('LatencyWindow', () => {
  it('summarises a rolling window', () => {
    const window = new LatencyWindow(3);
    expect(window.summary()).toEqual({ last: null, p50: null, p95: null, count: 0 });
    [100, 10, 20, 30].forEach((ms) => window.record(ms));
    expect(window.summary()).toEqual({ last: 30, p50: 20, p95: 30, count: 3 });
  });
});
