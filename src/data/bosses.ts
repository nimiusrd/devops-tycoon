/**
 * ボススプリントの宣言的定義（SPEC 第10章）。
 *
 * 四半期末の「山場」。通常スプリントの延長ではなく特別ルールを持つ。
 * タスク量や障害率の倍率と、突破判定（`clear`）をデータで持つ。
 * 判定の実装は `src/sim/outcome.ts`（純TS）。データ駆動（architecture §4.3）。
 */

/** ボス突破の判定条件（指定キーのみ評価。第14章の勝利に接続）。 */
export interface BossClearCheck {
  /** このボススプリント単体の出荷ポイント下限。 */
  minSprintDelivered?: number;
  /** 延焼（spread）の許容上限。 */
  maxSpread?: number;
  /** 技術的負債の許容上限。 */
  maxTechDebt?: number;
  /** AI 利用率の下限（%）。 */
  minAiPct?: number;
  /** Morale の下限。 */
  minMorale?: number;
  /** Quality の下限。 */
  minQuality?: number;
}

export interface BossDef {
  id: string;
  name: string;
  /** プレイヤー向け説明（`src/data/bossDisplay.ts` 参照）。 */
  description: string;
  /** タスク量の倍率（大型リリースは 2 倍など）。 */
  taskCountMul: number;
  /** 障害率の倍率（大規模障害ボスで上げる）。 */
  incidentMul: number;
  clear: BossClearCheck;
}

export type BossTemplate = Omit<BossDef, 'description'>;

export const BOSS_TEMPLATES: BossTemplate[] = [
  {
    id: 'big-release',
    name: '大型リリース',
    // RI-75: タスク床で山場の長さを確保し、倍率は難易度横断の上限超過を避ける。
    taskCountMul: 1,
    incidentMul: 1,
    clear: { minSprintDelivered: 90 },
  },
  {
    id: 'major-incident',
    name: '本番大規模障害',
    taskCountMul: 1,
    // RI-75: 炎上長尾を抑えつつ、障害ボスらしい圧は残す。
    incidentMul: 1.1,
    clear: { maxSpread: 2, minSprintDelivered: 40 },
  },
  {
    id: 'security-audit',
    name: 'セキュリティ監査',
    taskCountMul: 1,
    incidentMul: 1,
    clear: { maxTechDebt: 40, minQuality: 50 },
  },
  {
    id: 'exec-review',
    name: '経営レビュー',
    taskCountMul: 1,
    incidentMul: 1,
    clear: { minAiPct: 40, minMorale: 45, minQuality: 45 },
  },
];

/** 実行系カタログ用。説明文は射影対象外のため空文字。 */
export const BOSS_DEFS: BossDef[] = BOSS_TEMPLATES.map((boss) => ({ ...boss, description: '' }));
