/**
 * プレイテスト出力を、実行の**いちばん最初に**無効化する。
 *
 * `npm run playtest` は `tsc --noEmit && vitest run` の順に走る。出力の削除を Vitest 側
 * （`tests/playtest/playtest.test.ts`）だけに置くと、**型検査で落ちたときにテスト本体へ到達せず、
 * 削除も実行されない**。その状態で `playtest:report` / `playtest:check` を続けると、
 * 前回の成功結果を最新の測定値として集計してしまう。
 *
 * バランス変更に型エラーがあるときこそ「古い結果が残っている」ことに気付きにくいので、
 * 型検査より前で消す。Vitest 側の削除も、`vitest` を直接叩く経路のために残してある。
 */
import { rmSync } from 'node:fs';

const out = process.env.PT_OUT ?? 'playtest-out/runs.json';
rmSync(out, { force: true });
