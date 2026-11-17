# RI-209 採用候補の仕事サンプル

対象: [#605](https://github.com/nimiusrd/devops-tycoon/issues/605)、親 [#548](https://github.com/nimiusrd/devops-tycoon/issues/548)。

## 判断と採否

**表示改善の最小範囲を採用する。** プレイヤーは、今回の候補の能力・特性・仕事の例を在籍メンバーと比べ、予算を払ってベンチへ迎えるか、士気コストを払って見送るかを判断する。

着手時のmain（a8864577）・Issue本文・コメント・timelineを照合した。仕事サンプルや候補プレビューは未実装で、RecruitScreenには採用/見送りだけがあった。複数候補を新しく抽選するルールは加えず、現在の1人の候補を正確に見せる。比較相手は選択した在籍メンバーであり、別の採用オファーではない。

仕事の例は実装済みの基礎能力・traitを説明する文章として採用する。例ごとのボーナス、隠れ性能、仕事の成功保証、絶対的な配置適性は追加しない。人間が同程度の能力から採用理由を説明できるかという体験評価は**未実施・保留**であり、Issueを完了扱いにしない。

## 仕事の型と代償

数値は現在のアーキタイプの基礎能力（実装/レビュー/AI習熟）。実際の編成寄与はランク・trait・配置によって変わる。

| 型 | 能力 | 仕事の例 | 判断に使う既存の利益・代償 |
| --- | --- | --- | --- |
| recruit-ai-prodigy | 42/30/66 | AIの下書きを読み直し、修正して実装 | AI職人の手戻り軽減、ジュニアの星の経験値。レビュー能力も確認する |
| recruit-doc | 40/44/40 | 変更の手順を文書に残し、レビュー内容を確認 | 在籍による文書蓄積。配置とは独立した特性で、レビュー速度の追加特性ではない |
| recruit-mega | 60/28/44 | 複数の変更を一つの大きなPRにまとめて実装 | 実装寄与の倍率と引き換えにレビュー負荷が増える |
| recruit-rookie | 38/38/46 | 実装とレビューを練習しながら仕事を覚える | 経験値は伸びやすいが、スタミナ上限が低い |

在籍メンバーの能力・レベル・trait・スタミナも同じ表示形式で示す。比較は詳細を開いて任意の在籍メンバーを選べる。小画面は縦、幅に余裕がある場合は横に並べる。採用可能性と予算枯渇確認は既存のまま残す。

## 本番境界と決定論

- `planRecruitment`が従来と同じ`${seed}:${rngKey}`の局所RNGで、アーキタイプ、名前の順に抽選する。専用採用画面のkeyは`recruit-phase:q${quarterNumber}:s${sprintIndexInQuarter + 1}`を確定処理と共有する。
- 候補プレビューは同じロスターから採用後のコピーを計算するだけ。ランのRNG、予算、元のロスター、nextIdを変更しない。満員では候補を作らない。予算不足でも候補の内容と不足理由を確認できる。
- `tryRecruit`の共通計算を関数へ移すだけで、採用確率・能力・名前重複回避・支払順序は変えない。休息/ショップ/イベントの採用は従来のkeyを使う。これらの画面へプレビューは追加しない。
- 保存項目・schema・ruleset・リプレイ形式の変更は不要。seed、四半期、スプリント番号、ロスターから同じ候補を復元する。採用後は従来どおりベンチ、AI未配布。
- HTMLの採用画面だけを変更。既存のrest-panel、formation-member、fm-id、SpendConfirmとsemantic色を使い、Pixi・共有寸法・motionは変更しない。

## 比較条件と再現方法

`tests/unit/render/recruitCandidateView.test.ts`で、seed `ri209-0`〜`ri209-31`、easy、開始時ロスター、Q1/次スプリント1、予算100を固定する。プレビューと実際のhire後を比較し、さらに従来の局所RNG→pickRecruitArchetype→recruitMemberという計算結果とも全ロスター一致を確認する。32件で4種類すべてを含む。固定入力での一致は、採用確率の実測推定や面白さの証明ではない。

追加条件は`ri209-resume`の反復表示・JSON保存再開、`ri209-duplicate`のQ3/次スプリント3と名前重複、`ri209-exact`の予算ちょうど、満員。反復表示前後のcounterfactual frame全体が一致し、RNGを含むラン状態の不変を確認する。

UI操作テストでは比較相手の変更、予算不足・満員・確認取消・見送りを確認する。E2Eは`recruit-sample-7`のeasyで公開操作から到達する最初の採用ビートを用い、320×568、390×844、768×1024、1024×768、1280×800、1440×900で比較・採用・編成表示・実WebGLへの遷移を確認する。320pxはreduced motionを指定する。予算枯渇の既存E2Eでは確認対象の名前の一致も確認する。

実行は専用worktreeで次を使う。

```sh
devcontainer exec --workspace-folder . npm test -- tests/unit/render/recruitCandidateView.test.ts tests/unit/ui/recruitInteractions.test.ts tests/unit/sim/runEngineShop.test.ts --maxWorkers=1
devcontainer exec --workspace-folder . npm run build
devcontainer exec --workspace-folder . npm run lint
devcontainer exec --workspace-folder . npm run format:check
devcontainer exec --workspace-folder . --remote-env PLAYWRIGHT_PORT=5605 npm run test:e2e -- tests/e2e/recruit-work-sample.spec.ts tests/e2e/spend-risk.spec.ts --grep '実候補|保存再開でも候補|recruit は' --workers=1 --project=chromium
```

## 検証結果（2026-11-17）

- Dev ContainerのNode v24.16.0で対象ユニット36件、型チェックを含むbuild、対象E2E8件が成功（終了コード0）。32seedで旧計算との一致、4型の網羅、採用後の本人との一致を確認した。
- E2Eで6viewportの横はみ出し防止、主要操作の44px以上の高さと到達性、比較のキーボード展開・採用、390pxでの再読込・保存再開、予算枯渇確認の取消とフォーカス復帰を確認。全6viewportで採用後に実WebGLへ遷移した。
- 変更前のRecruitScreenを一時的に同じ状態へ戻して320/390/1280pxを撮影し、変更後とレイアウトを目視比較した。一時テストと一時ソースは削除し、画像はコミット対象外の`gallery/ri209/`へ置いた。
- 変更は採用画面だけ。Pixi描画の変更や複数画面の視覚変更はないため、Pixiスナップショット更新と全画面gallery実行は対象外。

## 残る評価条件

人間のプレイ確認は未実施。複数seedの候補について、仕事例を表示/非表示にした同じ状態で「採用または見送りの理由」「比較対象」「配置予定と代償」を説明できるか確認する。能力値とtraitの読み替え以上の判断材料にならず装飾文としてしか読まれない場合、文章と比較の配置を再調整する。採用率や楽しさが改善したとは未判定であり、この残条件は#605で追跡する。
