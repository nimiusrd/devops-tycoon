/**
 * プレイテスト実行の**最初**に旧出力を消す。
 *
 * Vitest の `globalSetup` はテストモジュールの読み込みより前に走る。テストファイルの
 * トップレベルへ置くだけでは足りないのは、ES モジュールが**静的 import を本体より先に**
 * 評価するためで、`harness.ts`（またはその依存）の変換・初期化で落ちると削除に到達しない。
 * その状態で `playtest:report` / `playtest:check` を続けると、失敗した実行ではなく
 * 前回の成功結果を最新値として集計してしまう。
 *
 * npm スクリプト経路は `scripts/invalidate-playtest-out.mjs` が型検査より前に消しているが、
 * `vitest run --config vitest.playtest.config.ts` を直接叩く経路はここが唯一の防波堤になる。
 */
import { rmSync } from 'node:fs';

export default function setup(): void {
  rmSync(process.env.PT_OUT ?? 'playtest-out/runs.json', { force: true });
}
