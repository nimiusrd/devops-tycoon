# #735 R&D 試作: 停止中に最大2手を予約する

本番機能ではない。Adopt / Iterate / Kill は書かない。人間が同じ seed で両腕を1スプリントずつ遊び、仮説 H1〜H3 を観察するための throwaway。

## ブラウザで開く

開発サーバはポート 5174。

```bash
npm run dev
```

- 予約なし: [http://localhost:5174/?rd=735&arm=none](http://localhost:5174/?rd=735&arm=none)
- 予約あり: [http://localhost:5174/?rd=735&arm=reserve](http://localhost:5174/?rd=735&arm=reserve)

seed 既定値は `RI-735`。上書きするなら `&seed=任意`。入口は `?rd=735`（別名 `issue-735` / `queue-moves`）。通常ランは起動しない。

短縮: `npm run rd:735`（なし） / `npm run rd:735:reserve`（あり）。

## 遊び方（両腕とも同じ意図方針）

意図方針: **PR分割（タスク0）→ ペアレビュー**。腕によって入力の出し方だけが違う。

1. 開始前に「予定した手」と「予測した成果」を書く（H1: 計画の理解）。空欄では開始できない。
2. 開始すると停止状態。予約なし腕は再生してからすぐに介入する（1 tick は約 0.9 秒）。予約あり腕は停止中に最大2手を予約し、再生で先頭から1 tick ずつ実行する。
3. 終了後、実績（出荷・完了・介入結果）を予測と見比べる。手応えを 1〜5 で押す（H2）。
4. 結果パネルと実行ログの壁時計3値が H3。停止時間は待ち時間と分けて記録する。ライブの「待ち時間（停止含む）」は 0 未満を出さない。

読む数字:

- 計画 / 予測（開始前に自分が書いた文）
- 実績: 出荷・完了・介入回数・集中力消費・士気
- H3 は次の3フィールド（結果パネル・実行ログの `timing including=…`・summary JSON）:
  - `wallClockIncludingPauseMs`: 開始から終了までの壁時計（停止含む）
  - `pausedMs`: 停止していた合計時間
  - `wallClockExcludingPauseMs`: 壁時計から停止時間を引いた値
- `wallClockMs` は `wallClockIncludingPauseMs` と同じ互換フィールド
- 予約あり腕: 各予約の `success` / `fail` / `cancelled`（`target-disappeared` / `double-trigger`）
- 手応え 1〜5

## スクリプトログ（パス/フェイル。仮説ではない）

```bash
npm run rd:735:check
```

seed `RI-735`、意図方針は両腕とも PR分割(T0) → ペアレビュー。`2026-10-06` 実行。

| 項目 | 予約なし | 予約あり |
| --- | ---: | ---: |
| tick | 16 | 16 |
| delivered | 87 | 87 |
| doneCount | 6 | 6 |
| focus 残り | 2 | 2 |
| focusSpent | 4 | 4 |
| interventionsUsed | 2 | 2 |
| seniorHp | 64.8 | 64.8 |
| morale | 59 | 59 |
| aiLiteracy | 36 | 36 |
| 予約結果 | （なし） | splitPr T0 success@0, pairReview success@1 |
| wallClockIncludingPauseMs（スクリプト） | 0 | 0 |
| pausedMs（スクリプト） | 0 | 0 |
| wallClockExcludingPauseMs（スクリプト） | 0 | 0 |
| wallClockMs（互換=including） | 0 | 0 |

H3 の人間値は結果パネルの3値と `rd-735-timing-json` を使う。スクリプトは `nowMs=0` なので 3値とも 0。

パス/フェイル（すべて pass）:

- determinism: 同じ seed・同じ予約順で summary と log が一致
- doubleSpend: 集中力2で pairReview→splitPr を予約。成功1・`no-focus` 失敗1・focusSpent=2・interventionsUsed=1
- doubleTrigger: 予約した splitPr T0 を再生直後にも手動。成功1・cancelled(double-trigger)1・`actionCounts.splitPr=1`・focusSpent=2
- targetDisappear: 予約前に T0 を消す。splitPr は `cancelled/target-disappeared`、消費なし（focus=6, splitCount=0）
- pausedBlock: 予約なし腕は停止中に打てず、消費なし
- cancelSpend: 予約を取消して再生しても消費なし

## ブラウザ確認（意図方針を両腕で実行）

`http://localhost:5174` で同じ seed を遊び、計画・予測を書いて開始し、終了後に手応え 4 を記録した。

| 項目 | 予約なし | 予約あり |
| --- | ---: | ---: |
| delivered | 87 | 87 |
| doneCount | 6 | 6 |
| interventionsUsed | 2 | 2 |
| focusSpent | 4 | 4 |
| morale | 59 | 59 |
| 待ち時間（当時は停止含む1値） | 14.8s | 15.1s |
| 手の結果 | 手動 splitPr T0 success / pairReview success | 予約 splitPr T0 success@0 / pairReview success@1 |
| 手応え | 4 | 4 |

スクリプトと同じ sim 数字になった。待ち時間は壁時計（停止含む）。Adopt / Iterate / Kill は書かない。
