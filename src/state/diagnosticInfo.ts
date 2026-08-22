/**
 * 不具合再現用のラン診断情報（RI-121）。
 *
 * ゲーム状態から表示・コピー可能な構造化情報を作る。ルールセットの
 * 指紋は省略せず、同じ入力条件を別ルールセットと混同しないようにする。
 */
import type { RunRulesetIdentity } from './runPersistence';
import type {
  DiagnosisType,
  DifficultyId,
  RunKind,
  RunPhase,
  RunState,
  RunStatus,
} from '../sim/run/types';

export const RUN_DIAGNOSTIC_SCHEMA_VERSION = 1 as const;

export interface RunDiagnosticInfo {
  schemaVersion: typeof RUN_DIAGNOSTIC_SCHEMA_VERSION;
  seed: string;
  ruleset: RunRulesetIdentity | null;
  runKind: RunKind;
  dailyDate: string | null;
  difficulty: DifficultyId;
  trials: string[];
  phase: RunPhase;
  status: RunStatus;
  diagnosis: DiagnosisType;
}

/** 現在のラン状態と記録時ルールセットから診断情報を組み立てる。 */
export function createRunDiagnosticInfo(
  state: Pick<
    RunState,
    'seed' | 'runKind' | 'dailyDate' | 'difficulty' | 'trials' | 'phase' | 'status' | 'diagnosis'
  >,
  ruleset: RunRulesetIdentity | null,
  diagnosis: DiagnosisType = state.diagnosis,
): RunDiagnosticInfo {
  return {
    schemaVersion: RUN_DIAGNOSTIC_SCHEMA_VERSION,
    seed: state.seed,
    ruleset: ruleset ? { ...ruleset } : null,
    runKind: state.runKind,
    dailyDate: state.dailyDate ?? null,
    difficulty: state.difficulty,
    trials: [...state.trials],
    phase: state.phase,
    status: state.status,
    diagnosis,
  };
}

/** 診断情報をキー順固定の、人が貼り付けやすい JSON へ変換する。 */
export function serializeRunDiagnosticInfo(info: RunDiagnosticInfo): string {
  return `${JSON.stringify(
    {
      schemaVersion: info.schemaVersion,
      seed: info.seed,
      ruleset: info.ruleset ? { ...info.ruleset } : null,
      runKind: info.runKind,
      dailyDate: info.dailyDate,
      difficulty: info.difficulty,
      trials: [...info.trials],
      phase: info.phase,
      status: info.status,
      diagnosis: info.diagnosis,
    },
    null,
    2,
  )}\n`;
}

/** 画面上でルールセット識別子を短縮せず表示する。 */
export function formatRunRuleset(ruleset: RunRulesetIdentity | null): string {
  return ruleset ? `v${ruleset.version} / ${ruleset.fingerprint}` : 'ルールセット不明';
}
