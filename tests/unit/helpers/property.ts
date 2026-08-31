import type { Parameters } from 'fast-check';

const DEFAULT_NUM_RUNS = 100;
const ENVIRONMENT = (
  globalThis as typeof globalThis & {
    process?: { env: Record<string, string | undefined> };
  }
).process?.env;

function readInteger(
  name: 'PBT_NUM_RUNS' | 'PBT_SEED',
  raw: string | undefined,
): number | undefined {
  if (raw === undefined) return undefined;
  if (!/^-?\d+$/.test(raw)) {
    throw new Error(`${name} must be an integer, received: ${JSON.stringify(raw)}`);
  }
  const value = Number(raw);
  if (!Number.isSafeInteger(value)) {
    throw new Error(`${name} must be a safe integer, received: ${JSON.stringify(raw)}`);
  }
  return value;
}

/**
 * 全 property test 共通の fast-check 設定。
 *
 * 失敗ログに表示された seed / path は次の形式で再現できる。
 * `PBT_SEED=<seed> PBT_PATH=<path> npm run test:property`
 */
export function propertyParameters(): Parameters<unknown> {
  const configuredRuns = readInteger('PBT_NUM_RUNS', ENVIRONMENT?.PBT_NUM_RUNS);
  if (configuredRuns !== undefined && configuredRuns <= 0) {
    throw new Error(`PBT_NUM_RUNS must be greater than zero, received: ${configuredRuns}`);
  }

  const seed = readInteger('PBT_SEED', ENVIRONMENT?.PBT_SEED);
  const path = ENVIRONMENT?.PBT_PATH;
  if (path !== undefined && !/^\d+(?::\d+)*$/.test(path)) {
    throw new Error(`PBT_PATH must be colon-separated integers, received: ${JSON.stringify(path)}`);
  }

  return {
    numRuns: configuredRuns ?? DEFAULT_NUM_RUNS,
    verbose: true,
    ...(seed === undefined ? {} : { seed }),
    ...(path === undefined ? {} : { path }),
  };
}
