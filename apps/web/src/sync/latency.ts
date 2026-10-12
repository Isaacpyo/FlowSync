export interface LatencySummary {
  last: number | null;
  p50: number | null;
  p95: number | null;
  count: number;
}

export function percentile(sorted: readonly number[], p: number): number | null {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index] ?? null;
}

/**
 * Rolling window of round-trip times (ms) for the latency badge: from
 * emitting a mutation to receiving the server's acknowledgement, i.e. the
 * time until an optimistic change is confirmed by Postgres.
 */
export class LatencyWindow {
  private samples: number[] = [];

  constructor(private readonly size = 50) {}

  record(ms: number): void {
    this.samples.push(ms);
    if (this.samples.length > this.size) this.samples.shift();
  }

  reset(): void {
    this.samples = [];
  }

  summary(): LatencySummary {
    const sorted = [...this.samples].sort((a, b) => a - b);
    return {
      last: this.samples[this.samples.length - 1] ?? null,
      p50: percentile(sorted, 50),
      p95: percentile(sorted, 95),
      count: this.samples.length,
    };
  }
}
