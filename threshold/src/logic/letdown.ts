import type { BlockKind, EngagementBlock, Intensity } from './model';
import { HOUR, fromIso, toIso, uid } from './time';

export const DECOMPRESSION: { id: string; label: string }[] = [
  { id: 'water', label: 'Drink water' },
  { id: 'meals', label: 'Eat steady meals' },
  { id: 'caffeine', label: 'Keep caffeine steady' },
  { id: 'magnesium', label: 'Magnesium, if in your plan' },
];

/** 6 h, plus 2 h per hour beyond the first, plus 3 h (high) or 6 h (very high). 6 to 24 h. */
export function letdownHours(startMs: number, endMs: number, intensity: Intensity): number {
  const hours = Math.max(0, (endMs - startMs) / HOUR);
  const bonus = intensity === 3 ? 6 : intensity === 2 ? 3 : 0;
  return Math.min(24, Math.max(6, Math.round(6 + 2 * Math.max(0, hours - 1) + bonus)));
}

export function startBlock(kind: BlockKind, intensity: Intensity, startedAt: number): EngagementBlock {
  return {
    block_id: uid(), kind, intensity, started_at: toIso(startedAt),
    ended_at: null, letdown_window_ends_at: null, decompression_done: [],
  };
}

export function endBlock(b: EngagementBlock, now: number): EngagementBlock {
  const h = letdownHours(fromIso(b.started_at), now, b.intensity);
  return { ...b, ended_at: toIso(now), letdown_window_ends_at: toIso(now + h * HOUR) };
}

export function toggleStep(b: EngagementBlock, id: string): EngagementBlock {
  const done = b.decompression_done.includes(id)
    ? b.decompression_done.filter((x) => x !== id)
    : [...b.decompression_done, id];
  return { ...b, decompression_done: done };
}

export const runningBlock = (blocks: readonly EngagementBlock[]) => blocks.find((b) => !b.ended_at) ?? null;

/** True if t falls inside some block's let-down window. */
export function inLetdown(blocks: readonly EngagementBlock[], t: number): boolean {
  return blocks.some((b) => b.ended_at && b.letdown_window_ends_at
    && fromIso(b.ended_at) <= t && t < fromIso(b.letdown_window_ends_at));
}

/** The open let-down window that ends last, if any. */
export function activeLetdown(blocks: readonly EngagementBlock[], now: number): EngagementBlock | null {
  let best: EngagementBlock | null = null;
  for (const b of blocks) {
    if (!b.ended_at || !b.letdown_window_ends_at) continue;
    if (fromIso(b.ended_at) <= now && now < fromIso(b.letdown_window_ends_at)
      && (!best || fromIso(b.letdown_window_ends_at) > fromIso(best.letdown_window_ends_at!))) best = b;
  }
  return best;
}
