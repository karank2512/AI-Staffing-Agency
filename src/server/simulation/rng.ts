import { AppError } from "@/server/errors";

/**
 * Seeded randomness for Simulated mode. Nothing in this module (or anywhere in simulation/) may call
 * Math.random(): every "random" choice is a pure function of a seed derived from the inputs, so the same
 * job produces the same run — which is what makes demos, tests and the Replace flow reproducible.
 */

/** FNV-1a (32-bit) with a murmur3 finalizer so near-identical strings still land far apart. */
export function hashSeed(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Small, fast PRNG (mulberry32). Returns floats in [0, 1). */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededPick<T>(arr: readonly T[], seed: number): T {
  if (arr.length === 0) throw new AppError("INTERNAL", "seededPick called with an empty array");
  return arr[Math.floor(mulberry32(seed)() * arr.length)];
}

/** Fisher–Yates on a copy; the input is never mutated. */
export function seededShuffle<T>(arr: readonly T[], seed: number): T[] {
  const out = arr.slice();
  const next = mulberry32(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Integer in [min, max] (inclusive). */
export function seededInt(seed: number, min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(mulberry32(seed)() * (max - min + 1));
}

/** `count` distinct elements, in shuffled order. */
export function seededSample<T>(arr: readonly T[], count: number, seed: number): T[] {
  return seededShuffle(arr, seed).slice(0, Math.max(0, count));
}
