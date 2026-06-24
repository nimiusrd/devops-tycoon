# フェーズ8: 四半期レビューと目標修正

| 項目 | 内容 |
| --- | --- |
| 対応フェーズ | 拡張 M8（四半期レビューと目標修正） |
| SPEC 参照 | 第3章 / 第4.6.1章 / 第10章 / 第14〜15章 / 第19章 |
| 前提 | M0〜M7 のラン進行・WebGL移行・メタ進行・組織スケールが動作していること |

## 目的

現状のランは「四半期末の目標を達成できたら勝ち、未達ならゲームオーバー」というローグライト寄りの構造になっている。
しかし実際の開発組織では、目標未達は即終了ではなく、スコープ・期限・品質・予算・体制を見直して次の期間へ進む。

フェーズ8では、未達を単なる敗北ではなく、**四半期レビューで原因を読み、目標を修正し、代償を払って組織を継続する判断**としてゲーム化する。
これにより「劣化 Slay the Spire」から、開発組織の継続的な目標調整シミュレーターへ寄せる。

## コア方針

- **目標未達 = 即 lost にしない**。まず `quarterReview` に遷移する。
- 未達でも、信頼・予算・士気・Senior HP などの継続リソースが残っていれば次四半期へ進める。
- 本当の敗北は「代償を払えない」「信頼が尽きた」「組織が継続不能」になったときに限定する。
- ボススプリントは敵ではなく、四半期末の外部評価（大型リリース、監査、経営レビュー、顧客レビュー）として扱う。
- プレイヤーに「どの約束を守り、どの約束を諦めるか」を選ばせる。

## サブステップ

| ID | 内容 | 主な編集先 | 完了の目安 |
| --- | --- | --- | --- |
| 8a | ドメインモデル追加 | `src/sim/run/types.ts`, `src/sim/run/engine.ts` | 四半期目標・信頼・レビュー結果をスナップショットに含める |
| 8b | フェーズ遷移変更 | `src/state/runMachine.ts`, `src/sim/run/engine.ts` | ボス未達時に `lost` ではなく `quarterReview` へ遷移 |
| 8c | レビュー判定ロジック | `src/sim/run/*` | 達成 / 一部未達 / 継続不能を決定論で算出 |
| 8d | 目標修正アクション | `src/sim/run/*`, `src/data/*` | スコープ削減・期限延長・品質改善などを選べる |
| 8e | UI追加 | `src/ui/QuarterReviewScreen.tsx`, `src/App.tsx` | 達成度・信頼・未達理由・修正選択肢を表示 |
| 8f | 次四半期への持ち越し | `src/sim/run/engine.ts`, `src/state/meta.ts` | 選択の代償が次期の制約として残る |
| 8g | テスト / E2E | `tests/unit/*`, `tests/e2e/*` | 未達→レビュー→修正→継続、継続不能→lost を保証 |

## データモデル案

```ts
export type StakeholderId = 'management' | 'customers' | 'team';

export interface QuarterGoal {
  deliveryTarget: number;
  qualityTarget: number;
  techDebtLimit: number;
  moraleTarget: number;
  incidentLimit: number;
  aiAdoptionTarget?: number;
}

export interface StakeholderTrust {
  management: number;
  customers: number;
  team: number;
}

export type QuarterOutcome =
  | 'exceeded'
  | 'met'
  | 'missed_adjustable'
  | 'missed_crisis'
  | 'reorg_required'
  | 'shutdown';

export type GoalAdjustmentId =
  | 'cut_scope'
  | 'extend_deadline'
  | 'quality_pivot'
  | 'request_budget'
  | 'pause_ai_rollout'
  | 'reorg_teams';

export interface QuarterReview {
  goal: QuarterGoal;
  outcome: QuarterOutcome;
  trust: StakeholderTrust;
  missedReasons: string[];
  availableAdjustments: GoalAdjustmentId[];
}
```

## 目標修正アクション

| 選択 | 効果 | 代償 |
| --- | --- | --- |
| スコープ削減 | Delivery 目標を下げ、次期へ継続しやすくする | 顧客信頼低下 |
| 期限延長 | 品質・士気を守って再挑戦 | 経営信頼低下、予算消費 |
| 品質改善ピボット | Tech Debt / Incident を下げる | 出荷評価低下、短期スコア低下 |
| 追加予算申請 | 採用・AIツール・外部支援を得る | 経営信頼低下、次期予算制約 |
| AI導入一時停止 | Review / Rework を安定化 | AI Adoption 評価低下、短期速度低下 |
| 組織再編 | 属人化やレビュー停止をリセット | 士気低下、メンバー離脱リスク |

## UI方針

`QuarterReviewScreen` は勝敗画面ではなく、レビュー会議として表示する。

- 今期の目標と実績を横並びで表示する。
- 達成 / 未達 / 超過達成を KPI ごとに表示する。
- 経営・顧客・チーム信頼をゲージで表示する。
- 未達理由を診断メッセージとして表示する。
- 継続可能な場合は目標修正カードを選ばせる。
- 継続不能な場合のみ、プロジェクト終了 / 組織再編としてラン終了にする。

## 成果物

- `RunPhase` に `quarterReview` / `goalAdjustment` 相当のフェーズを追加。
- `RunState` に `quarterGoal` / `stakeholderTrust` / `quarterReview` を追加。
- ボス未達時の即 `lost` を廃止し、レビュー判定へ移す。
- レビュー結果に基づき、次四半期へ進むか、継続不能で終了する。
- 目標修正の選択が組織ステータスと次期目標に反映される。

## テスト

- **Vitest**
  - 目標達成時は高評価レビューになる。
  - 軽微な未達は `missed_adjustable` になり、修正選択肢が出る。
  - 信頼・予算・士気が枯渇している未達は `shutdown` または `reorg_required` になる。
  - 各目標修正アクションの効果と代償が決定論で反映される。
  - 同一 seed / 同一状態では同一レビュー結果になる。
- **Playwright**
  - ボス未達 → 四半期レビュー → スコープ削減 → 次四半期へ継続。
  - 継続リソース枯渇 → 四半期レビュー → ラン終了。

## 完了の目安（DoD）

- 未達時に即 `GAME OVER` へ行かず、レビュー画面で原因と選択肢が提示される。
- プレイヤーが目標修正を選ぶと、代償を払って次四半期へ進める。
- 継続不能条件が明確で、単なる目標未達とは区別されている。
- レビュー結果と修正選択がテストで決定論的に保証されている。
- 既存の勝利・メタ進行・デイリーランと矛盾しない。

## リスク・留意点

- 複雑にしすぎると初回プレイの理解が難しくなるため、最初は Delivery / Quality / Tech Debt / Morale / Incident の5指標に絞る。
- 信頼ゲージは経営・顧客・チームの3種類までに抑える。
- 目標修正は最初から全選択肢を入れず、3種類（スコープ削減・期限延長・品質改善ピボット）から始めてもよい。
- `lost` は削除せず、継続不能時の最終状態として残す。
- メタ進行報酬は「四半期レビューの評価」に紐づけ、未達でも学習・改善ポイントを少量得られるようにする。
