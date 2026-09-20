# R&D 盤面 A/B プロトタイプ（本番マージ禁止）

このブランチは **捨て実験** です。現行の四半俯瞰／アイソメ盤面（A）と、最小のレーン盤面（B）を、同じ固定 live 場面で切り替えて可読性だけを見ます。アート仕上げ・本番盤面の書き換え・バランス再調整はしません。

## 仮説

- **H1**: 色に頼らず、炎上・渋滞・延焼を 3 秒以内に指せるか。B が A より良い想定。
- **H2**: 狭い幅での隠れ・タップ不能が、B の方が少ない想定。

成功判定（この PR）は「同じシード場面で A/B とヒット領域を切り替えられること」だけです。プレイテストは Researcher が行います。

## 起動（1 分以内）

開発サーバ: `npm run dev`（ポート 5174）。

同じ固定場面:

| 条件 | URL |
| --- | --- |
| A 現行 iso | `/?rd=iso&rdScene=stress&tutorial=off` |
| B レーン | `/?rd=lane&rdScene=stress&tutorial=off` |
| H2 測定 A（狭い幅・覆いなし） | `/?rd=iso&rdScene=stress&tutorial=off&rdMeasure=1` |
| H2 測定 B（狭い幅・覆いなし） | `/?rd=lane&rdScene=stress&tutorial=off&rdMeasure=1` |

盤面上の **R&D A/B** ピッカーでも `A iso` / `B lane` を切り替えられます（`history.replaceState`。場面は再生成しない）。`rdMeasure=1` のときはピッカーを出さないので、URL の `rd=iso|lane` だけで切り替えます。

### H2 測定（狭い幅）

前回の H2 は出来事ティッカーと盤上ピッカーがヒット円を覆って交絡していました。測定モードは **同じ固定場面** のまま、盤面を覆う UI だけを消します。レーン／iso の幾何は変えません。

1. 開発サーバを起動する（`npm run dev`、ポート 5174）
2. ブラウザ幅を約 **375px** にする（または DevTools の iPhone SE 相当）
3. 上表の H2 測定 URL を開く
4. 炎上 `#9001`・延焼 `#9002`・Review 粒の破線円が、ティッカー／ピッカーに覆われていないことを確認する
5. A と B は URL の `rd=` だけ差し替えて再読込する（再ビルド不要）

`rdMeasure=1` で隠すもの: 出来事ティッカー（盤面右上の jam/fire 行を含む）、盤上 R&D A/B ピッカー。信号ラベルとヒット円は残します（`pointer-events: none`）。HUD の渋滞／炎上メーターは盤面の外なので残します。

既定（`?rd` なし、`rdMeasure` なし）は現行 iso / 通常タイトル起動のままです。`?rd=lane` だけ付けると、通常プレイの盤面レイアウトだけがレーンになります。

## 固定場面

`rdScene=stress` は通常スプリントを開始して pause し、**盤面・渋滞メーター・炎上メーター**（測定モードでなければティッカーも）に固定場面を載せます。シミュレーション本体（`RunEngine` / バランス表）は書き換えません。

- **渋滞**: Review 件数が `REVIEW_HOT_QUEUE`（12）ちょうど
- **炎上**: Rework の燃焼中タスク `#9001`
- **延焼**: `#9001` → Review の incident `#9002`（ラベルと破線。延焼演出そのものは一瞬なので常駐スタンドイン）

seed は `rd-board-ab-stress`。HUD・介入バーは現行のままです。盤面上の「炎上 / 渋滞 / 延焼」ラベルは色に依存しない指差し用です。破線の円は実ヒット半径（直径/2 + `dotHitMargin`）。盤面クリックで `hit: #id` が更新されます。

## ノブ

| ノブ | 場所 | 意味 |
| --- | --- | --- |
| `?rd=iso\|lane` | `src/render/rdBoardLayout.ts` | 盤面レイアウト。未指定は iso |
| `?rdScene=stress` | 同上 | 固定場面を自動ロード |
| `?rdMeasure=1` | 同上 | H2 測定。ティッカーと盤上ピッカーを隠す。未指定は出したまま |
| `REVIEW_HOT_QUEUE` | `src/render/boardScene.ts` | 渋滞判定。**値は変えていない** |
| `LANE_DOT_DX` / `LANE_DOT_DY` | `src/render/boardScene.ts` | レーン粒の間隔（ヒット円が重ならない幅） |
| `boardDropZones('lane')` | 同上 | レーンのドロップ円。半径 48（列が重ならない） |
| `RD_FIRE_TASK_ID` / `RD_SPREAD_TARGET_TASK_ID` | `src/render/rdBoardPrototype.ts` | 炎上元 / 延焼先の固定 ID |

`window.game.loadRdBoardPrototypeScene()` でも同じ場面を載せられます。

## 触っていないもの

- バランス定数・AI・カード効果・確率モデル
- `RunEngine` のホットパス（固定場面は盤面表示の overlay。エンジンメソッドは足していない）
- HUD の見た目 / ActionBar / スプリントルール（`rdScene=stress` 時だけ渋滞・炎上メーターとティッカーが overlay を読む）
- 既定 iso のステーション座標と Pixi 視覚回帰ベースライン
- レーン盤面の幾何（`LANE_*`。測定モードは覆いを消すだけ）
- 組織／部署／業界マップ（`iso.ts` の投影）
- 本番セーブ（プロトタイプ起動は途中セーブを書かない）

## 実装の境界

- シーン計画は同じ `BoardScenePlan`。`planBoardScene(tasks, moods, layout)` の第 3 引数だけが増えた
- ヒット判定は既存 `hitTestBoardDot` / `hitTestDropLane`。lane 時は座標とドロップ円だけ差し替える
- レーン背景は単純な横帯。既存キャラ／粒スプライトを再利用（新規アートなし）

## デザインシステム例外

DS-03 / DS-04: プロトタイプオーバーレイとレーン背景は本番コンポーネントを増やさず、既存トークン色だけを使う局所 UI。本番マージしない前提。

## 検証コマンド

```bash
npm test -- tests/unit/render/rdBoardLayout.test.ts tests/unit/render/rdBoardPrototype.test.ts tests/unit/render/boardScene.test.ts tests/unit/render/boardDragPlan.test.ts --maxWorkers=1
npm run test:e2e -- tests/e2e/rd-board-ab.spec.ts --workers=1
```
