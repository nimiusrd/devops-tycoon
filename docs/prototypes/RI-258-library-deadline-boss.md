# RI-258: 重要領域と一括整備を選ぶ仮想ライブラリの期限戦

対象 [#654](https://github.com/nimiusrd/devops-tycoon/issues/654)、親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。結論は **期限・確認集中・持越しの最小比較を成立させ、本番採用は保留**。人間のプレイ評価は未実施。試作のマージを本番採用や面白さの証明とは扱わない。

検証する判断は「短期の重要領域と通常出荷を守り、古い依存を残すか、確認が集中しても全件を整備するか」。既存ルールの説明改善ではなく、依存ごとの保守期限と確認待ちを持つ新ルールの検討である。通常ランから隔離した純TSモデル・テスト・この文書・比較JSONの4ファイルで完結する。

## 局面と公開情報

| 局面 | 情報と入力 |
| --- | --- |
| 準備 tick 0 | 3依存の重要度、影響範囲、実装/確認工数、期限、猶予、障害損失、共通処理枠、一括確認の調整工数を選択前に公開する。計画を1回選ぶか、そのまま進む |
| 開始 tick 1 | 最初の処理前。選んだ計画と未着手工数を確認し、進む |
| ピーク tick 2〜6 | 次の処理tickと、前tickまでの実装/確認進捗、更新済み領域、通常出荷、障害を確認し、進む |
| 結果 tick 7 | 6tick分の出荷・障害・確認完了tick・更新領域・旧依存・残実装/確認/調整工数・次期持越しを確認する |

`viewLibraryDeadlineBoss` は表示用データのコピーを返し、閲覧で状態・時計を変えない。表示の `tick` は次に処理するtickで、`periods` は処理済みtickだけを含む。全係数が公開された固定盤面であり、未来の隠し情報や不確実性の推測は検証しない。

`plan` は準備中に1回だけ。`batch` は3件全部を任意順で指定、`focus` は1〜3件を任意順で指定する。空・重複・未知ID、一括の対象欠落、再計画、開始後の計画、結果後の操作は拒否し、時計・工数・入力履歴を変えない。選択自体は時計を進めず、`advance` で準備から開始へ移り、以降の各 `advance` で1tickを処理する。ピーク中の対象変更や作業キャンセルは初手に含めない。

## 期限・更新・最低限の進行

架空名であり、実在パッケージ、バージョン、現実の日付、脆弱性情報とは対応しない。全方針で毎tick4工数、6tick、計24工数を共通とする。

| 仮想依存 | 重要度 | 影響範囲 | 実装 | 確認 | 期限tick | 猶予 | 超過tickごとの障害損失 |
| --- | --- | --- | ---: | ---: | ---: | ---: | ---: |
| ledger-kernel | critical | billing / orders | 4 | 2 | 1 | 1 | 6 |
| relay-mesh | important | search / notifications | 3 | 2 | 3 | 1 | 3 |
| palette-cache | low | catalog | 2 | 1 | 4 | 1 | 1 |

期限は固定トラック上のローカルtickを仮定し、通常ランのトラックへは接続しない。**期限当日と猶予の最終tickまでは損失0。`tick > deadlineTick + graceTicks` で未更新なら、その依存の障害と損失を毎tick記録する**。ledger-kernelならtick1が期限、tick2が猶予、tick3から損失。処理順は「実装・確認→確認完了を反映→障害判定」で、損失開始tickでもそのtick中の確認完了は間に合う。過去の障害は後の更新で消えない。

実装が0でも確認が残れば旧依存のまま。確認が0になったtickだけ更新済み領域へ加え、同じ対象の成果を重複計上しない。一括では指定順に全実装を終え、追加の調整2工数を払い、指定順に確認する。重点では指定順に1件ずつ実装と確認を終える。余剰枠は同tickの次工程へ使う。一括でも全件同時の完了フラグは持たず、確認済みの対象だけが更新される。

更新に使わなかった枠は通常出荷へ自動配分する。選択しない場合は毎tick4出荷し続ける。障害は影響依存ごとの損失指標として残し、処理枠や出荷を二重減算しない。旧依存の運用停止・全社敗北・ゲームオーバーは設けない。これは保守終了に必ず事故が起きるという現実のモデルではなく、判断を比較するための決定論の仮定である。

## 同条件比較と係数への依存

seedは `RI-258`。乱数を消費しない固定盤面なのでseedは再現記録用であり、別seedの同一結果を独立した検証例として水増ししない。比較方針は無操作、一括（ledger→relay→palette）、重点（ledger→relay、paletteを残す）に加え、対照として逐次全件（focusモードで3件）も含める。同じ初期状態と資源から比較し、選択順の違いもモデルでは入力可能とする。

| 方針 | 通常出荷 | 障害件数（依存×tick） | 障害損失 | 更新完了tick | 持越し工数 |
| --- | ---: | ---: | ---: | --- | ---: |
| 無操作 | 24 | 7 | 31 | なし | 14 |
| 一括 | 8 | 1 | 6 | 全3件tick4 | 0 |
| 重点 | 13 | 1 | 1 | ledger tick2 / relay tick3 | paletteの実装2＋確認1 = 3 |
| 逐次全件 | 10 | 0 | 0 | ledger tick2 / relay tick3 / palette tick4 | 0 |

一括はledgerの実装がtick1に終わっても確認待ちが残り、tick3で損失6を受ける。重点は重要2件を先に確認し、出荷5工数を多く残すが、paletteが旧依存のままtick6に損失1を受け、次期3工数を残す。無操作も継続するが、重要依存を含む旧依存14工数と損失31が残る。未選択依存を工数0として扱わない。

比較値は `通常出荷×2 − 障害損失 − 持越し工数×持越し単価`。次期作業を現在の出荷や実際の予算から課金するルールではなく、評価上の機会費用である。

| 持越し単価 | 無操作 | 一括 | 重点 | 逐次全件 |
| --- | ---: | ---: | ---: | ---: |
| 0 | 17 | 10 | 25 | 20 |
| 2（基準） | -11 | 10 | 19 | 20 |
| 6 | -67 | 10 | 7 | 20 |

持越し単価6では一括10 > 重点7に逆転する。加えて、一括の集中調整を2→0工数へ変えた同条件比較もJSONに記録する。一括は出荷10・障害0・持越し0・基準比較値20となり、重点19を上回る。したがって重点の基準順位は集中調整という仮定にも依存する。工数・期限・出荷価値・障害係数の広い探索、適応的な方針、人間の判断は未評価。計算の順位を楽しさや本番バランスの証明へ読み替えない。

**対照の逐次全件は、基準係数で一括より出荷が2多く、障害がなく、同じ持越し0になる**。一括には効率上の利益をまだ付けていないため、今回の盤面では一括が逐次全件に劣る。一括と重点だけの順位逆転を「全選択肢が成立した」と扱わない。重点と逐次全件の間には、単価0で25 > 20、単価2で19 < 20という交換が残る。一括の仮説を次に評価する前に、共通作業の節約や確認効率など実装上の利益を別盤面で検証する必要がある。利益を証明するために今回の値を後付けで調整しない。

## 再現・保存・検証

`library-deadline-comparison.json` はversion 1の信頼済み内部記録。各方針のseed、初期工数と全係数、全入力列、tickごとの進捗と障害、結果、単価感度、調整工数感度を残す。全入力再生・毎入力のJSON保存再開・閲覧挿入の一致、元状態の非変更、各tickの工数保存、実装/確認の工数保存、期限当日/猶予最終/翌tick、未確認の非完了をテストする。外部JSONの検証や旧形式の移行は対象外。

専用worktreeのルートで実行:

```sh
devcontainer exec --workspace-folder . node --version
devcontainer exec --workspace-folder . npm test -- src/prototypes/libraryDeadlineBoss.test.ts --maxWorkers=1
devcontainer exec --workspace-folder . npx tsc -b
devcontainer exec --workspace-folder . npm run lint
devcontainer exec --workspace-folder . npm run format:check
```

JSON再生成:

```sh
devcontainer exec --workspace-folder . node --input-type=module <<'JS'
import { createServer } from 'vite';
import { writeFileSync } from 'node:fs';
const server = await createServer({ configFile: false, server: { middlewareMode: true }, optimizeDeps: { noDiscovery: true }, appType: 'custom' });
try {
  const { compareLibraryDeadlineBoss } = await server.ssrLoadModule('/src/prototypes/libraryDeadlineBoss.ts');
  writeFileSync('docs/prototypes/library-deadline-comparison.json', JSON.stringify({
    version: 1,
    results: compareLibraryDeadlineBoss(),
    coordinationSensitivity: compareLibraryDeadlineBoss(0),
  }, null, 2) + '\n');
} finally { await server.close(); }
JS
devcontainer exec --workspace-folder . npx prettier --write docs/prototypes/library-deadline-comparison.json
```

既存UI・文言・描画・visual tokenを変更しないため、HTML/WebGL E2E・Pixi視覚回帰・galleryは対象外。通常sim、通常保存、ruleset、package.json、共通文書へは変更を加えない。

## 既存モデルとの境界と次の判断条件

`apiSpecChange` は単一APIの仕様変更に対する追随・代替・停止の比較。この試作はAPIの置換や停止をせず、3依存それぞれの保守期限・影響範囲・確認待ちを比較する。`taskDependencies` は前提完了によるタスクの出荷可否を扱うDAG。この試作では依存同士にDAGはなく、未更新でも通常出荷し続け、期限後に依存別の損失が残る。どちらのモデルも変更・共用しない。

採否は **本番採用保留**。最小試作と比較記録は完了したが、Issueは人間評価と本番判断を追跡するためopenを維持する。次に再評価する条件は、まず逐次全件に対する一括の利益が成立する盤面と成立しない盤面を比較すること。その後、隔離した操作画面で「実装済み」と「確認完了」を読み分けられ、期限/猶予/損失/持越しを選択前後に確認できること。最低5人が一括/重点/逐次全件を体験し、選択理由、確認集中の納得、旧依存を残す納得、もう一度順序を変えたいかを記録する。調整工数・期限の異なる盤面を追加し、現係数だけが判断を作っていないか確認してから採否を再判定する。実施日と人間評価結果は未定・未実施。

採用時は別Issueで通常トラック上の発生箇所、保守終了後の損失・猶予の意味、確認工程、途中の再配分可否、持越しの次期接続、ボスID・抽選率、HTML要約とPixi描画、保存形式/rulesetの版と旧保存の既定値、通常リプレイの互換を確定する。現定数をそのまま本番値にせず、通常ランの固定トラック・勝利種別・WebGL準備中の停止契約を維持する。
