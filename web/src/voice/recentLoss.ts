/** One stream's running totals, as getStats reports them. */
export interface LossTotals {
  lost: number;
  received: number;
}

/**
 * Packet loss since the previous reading. getStats reports totals over the
 * whole call, so a figure made from them alone barely moved after an hour —
 * thirty seconds of heavy loss was a quarter of a percent, and the indicator
 * stayed green while the call broke up (and an early bad patch kept it red for
 * minutes). This keeps each stream's last totals and measures the difference.
 */
export class RecentLoss {
  private prev = new Map<string, LossTotals>();

  measure(streams: Map<string, LossTotals>): number {
    let lost = 0;
    let received = 0;
    for (const [id, now] of streams) {
      const before = this.prev.get(id);
      // a stream seen for the first time has nothing to compare with, and one
      // whose counters went back has been replaced
      if (!before || now.lost < before.lost || now.received < before.received) continue;
      lost += now.lost - before.lost;
      received += now.received - before.received;
    }
    this.prev = streams;
    const total = lost + received;
    return total > 0 ? lost / total : 0;
  }

  reset(): void {
    this.prev.clear();
  }
}
