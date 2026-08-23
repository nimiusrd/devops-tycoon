/**
 * バランスルールセットの版と指紋。
 *
 * 版は手動で単調増加させる識別子、指紋は実行値とコンテンツから決まるハッシュである。
 * 版は指紋入力に混ぜない。式・分岐・乱数消費順など射影に出ない変更は版を1増やす。
 */
import { canonicalizeJson, compareCanonicalStrings, sha256Hex } from './canonical';
import type { BalanceDefinition, BalanceEntry, ProbabilityDistribution } from './types';

/** ルールセット版。結果へ影響する変更で直前の値から 1 増やす。 */
export const BALANCE_RULESET_VERSION = 3;

/** 指紋の射影・算出方式の版。方式を変えるときは指紋が変わり、手動版も 1 増やす。 */
export const BALANCE_RULESET_FINGERPRINT_SCHEME = 1;

/**
 * 指紋から除外する安定ID接頭辞。体験目標帯など、ゲームが参照しない検証メタデータ。
 * `tags` は表示・分類用であり、指紋対象の判定には使わない。
 */
export const BALANCE_RULESET_FINGERPRINT_EXCLUDED_ID_PREFIXES = ['pacing.target.'] as const;

/** 版の更新規則と指紋対象。生成文書とテストで共有する。 */
export const BALANCE_RULESET_VERSION_POLICY = {
  bump: [
    'ゲームが参照する値、式、分岐、丸め位置、乱数消費順を変える',
    '結果へ影響するコンテンツのID、値、重み、抽選・評価に使う配列順を変える',
    '指紋の射影または算出方式を変える',
  ],
  noBump: [
    'label、description、unit、allowedRange、tags、derived などの表示・検証専用メタデータだけを変える',
    '体験目標帯などの検証メタデータ、表示専用値、テスト・測定条件、生成物の整形だけを変える',
  ],
  fingerprintIncludes: [
    'バランスレジストリの安定IDと実行値',
    '抽選・評価に使う配列順',
    'コンテンツのゲーム結果へ影響するID・値・重み',
  ],
  fingerprintExcludes: [
    'label、description、unit、allowedRange、tags、derived、integer',
    '体験目標帯などの検証メタデータ、表示専用値',
    'seed と入力列',
  ],
} as const;

export type BalanceRulesetVersionPolicy = typeof BALANCE_RULESET_VERSION_POLICY;

/** レジストリ射影。スカラーは ID 順、分布の定義順は sequences で保持する。 */
export interface BalanceRegistryProjection {
  readonly values: readonly { readonly id: string; readonly value: number }[];
  readonly sequences: Readonly<Record<string, readonly string[]>>;
}

export interface BalanceRulesetPayload {
  readonly fingerprintScheme: number;
  readonly registry: BalanceRegistryProjection;
  readonly catalog: unknown;
}

function isProbabilityDistribution(
  definition: BalanceDefinition,
): definition is ProbabilityDistribution {
  return 'entries' in definition;
}

function isFingerprintRuntimeEntry(entry: Pick<BalanceEntry, 'id'>): boolean {
  return !BALANCE_RULESET_FINGERPRINT_EXCLUDED_ID_PREFIXES.some((prefix) =>
    entry.id.startsWith(prefix),
  );
}

/** 安定IDと実行値だけへ射影し、表示・検証専用メタデータは落とす。 */
export function projectBalanceRegistry(
  definitions: readonly BalanceDefinition[],
): BalanceRegistryProjection {
  const values: { id: string; value: number }[] = [];
  const sequences: Record<string, readonly string[]> = {};

  for (const definition of definitions) {
    if (isProbabilityDistribution(definition)) {
      if (isFingerprintRuntimeEntry(definition)) {
        sequences[definition.id] = definition.entries
          .filter(isFingerprintRuntimeEntry)
          .map((entry) => entry.id);
      }
      for (const entry of definition.entries) {
        if (isFingerprintRuntimeEntry(entry)) {
          values.push({ id: entry.id, value: entry.value });
        }
      }
      continue;
    }
    if (isFingerprintRuntimeEntry(definition)) {
      values.push({ id: definition.id, value: definition.value });
    }
  }

  values.sort((left, right) => compareCanonicalStrings(left.id, right.id));
  return { values, sequences };
}

/** 指紋計算の入力。版と seed は含めない。 */
export function createBalanceRulesetPayload(
  registry: readonly BalanceDefinition[],
  catalog: unknown,
): BalanceRulesetPayload {
  return {
    fingerprintScheme: BALANCE_RULESET_FINGERPRINT_SCHEME,
    registry: projectBalanceRegistry(registry),
    catalog,
  };
}

/** 正規化 JSON の SHA-256 hex。同じ入力ならブラウザと Node で一致する。 */
export function fingerprintBalanceRuleset(payload: BalanceRulesetPayload): string {
  return sha256Hex(canonicalizeJson(payload));
}
