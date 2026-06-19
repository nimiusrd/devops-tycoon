export type Seed = string | number;

export interface Rng {
  next(): number;
  int(min: number, max: number): number;
  pick<T>(items: readonly T[]): T;
  bool(probability: number): boolean;
}

const UINT32_MAX_PLUS_ONE = 0x1_0000_0000;

export function normalizeSeed(seed: Seed): number {
  if (typeof seed === 'number') {
    return seed >>> 0;
  }

  let hash = 0x811c9dc5;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  return hash >>> 0;
}

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;

  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / UINT32_MAX_PLUS_ONE;
  };
}

export function createRng(seed: Seed): Rng {
  const nextValue = mulberry32(normalizeSeed(seed));

  return {
    next() {
      return nextValue();
    },

    int(min: number, max: number) {
      if (!Number.isInteger(min) || !Number.isInteger(max)) {
        throw new Error('Rng.int requires integer bounds.');
      }

      if (max < min) {
        throw new Error('Rng.int requires max to be greater than or equal to min.');
      }

      return Math.floor(nextValue() * (max - min + 1)) + min;
    },

    pick<T>(items: readonly T[]) {
      if (items.length === 0) {
        throw new Error('Rng.pick cannot choose from an empty collection.');
      }

      return items[Math.floor(nextValue() * items.length)];
    },

    bool(probability: number) {
      if (probability < 0 || probability > 1) {
        throw new Error('Rng.bool requires probability between 0 and 1.');
      }

      return nextValue() < probability;
    },
  };
}
