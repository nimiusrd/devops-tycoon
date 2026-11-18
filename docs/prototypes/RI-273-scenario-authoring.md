# RI-273 シナリオ作者JSONの最小試作

対象: [Issue #669](https://github.com/nimiusrd/devops-tycoon/issues/669)、親 #548。判断は **再試作**。JSONの拒否・再現契約は確認できたが、編集UI、作者の使いやすさ、人間による課題のプレイ評価は未実施。試作PRのマージを本番採用・Issue完了とは扱わず、Issueはopenを維持する。

## 検証する価値と境界

作者が現場に似た条件を小さく作り、同じ課題を渡せることを仮説とする。自由に編集できる項目を増やすと再現の幅は広がるが、成立する課題の説明と検証が難しくなる。今回は組織2値とタスク構成1項目だけで条件を再現できるかをAPIで調べた。

| 条件 | 既存StartRecipe | この専用JSON v1 |
| --- | --- | --- |
| seed・難易度・既存scenario | 共有する | `base`として同じIDを共有する |
| trials・preferredCardIds | 共有し、受信者の解放を検査 | 対象外。指定すると未知キーで拒否。試練なし・初期編成固定 |
| testCoverage・documentation | 任意値を編集しない | `initialOrg`で各0..100の有限数を絶対指定 |
| タスク規模と順序・件数 | seedと本番規則から生成 | `taskKinds` 1配列で指定（1..120件） |
| 他の組織値・高価値フラグ・途中盤面・勝利種別 | 作者編集なし | 作者編集なし。未知キーとして拒否 |
| メタ・デイリー・通常セーブ・通常リプレイ | それぞれ既存所有者が管理 | 接続しない。独立API/識別子だけを持つ |

通常ランの固定トラック・自動WinType判定は変更しない。この試作は最初のスプリントの盤面生成と無介入進行だけで、ラン全体や勝敗を作らない。作者設定の通常ラン起動、課金、報酬、実績、履歴、公開投稿基盤、ファイル選択画面もない。

既存の[開始レシピPR #310](https://github.com/nimiusrd/devops-tycoon/pull/310)と現行`src/state/startRecipe.ts`を照合した。関連する#694はカード制限と追加課題を扱う別試作で、この作者JSON/APIから相互参照しない。

## 形式と再現方法

- 入力例: [scenario-authoring-example.json](./scenario-authoring-example.json)。`kind: scenario-authoring-prototype`、`schemaVersion: 1`、試作規則ID、現行バランス版・指紋を必須とする。
- `ScenarioAuthoring.fromJSON(raw)` → `start()` → `snapshot()`。`advance(ticks)`で無介入の実simを進める。`result()`は完了時だけ実simの結果を返す。
- `RunEngine.startRun` / `beginSetupSprint` / `exportCounterfactualFrame`の公開APIで実際のS1入力を取得する。難易度・scenario・seed由来の初期組織、編成係数、集中力、コーディング枠、予算を使い、`createSprintFromBaselineInput`へ渡す直前に組織2値・タスク件数を上書きする。編成由来の係数や他の初期資源は作者値から再計算しない。
- タスクは実`createSprint`で生成し、規模だけを配列順に置換する。各タスクの規模抽選・高価値抽選の2乱数消費は維持する。規模の上書きでは追加抽選しない。件数変更時はRNG位置も変わる。
- `checkpoint()`は`scenario-authoring-checkpoint`形式のJSONを返す。元条件、成立済みtick、消費後RNG状態を保存する。`resume(raw)`は最初からそのtickまで実simを再計算し、RNG状態・実到達tickと照合する。任意盤面をhydrateしない。開始直後・途中・完了時の再開に対応する。
- 同じJSON/seed/現行コード・規則なら同じ盤面とRNGを生成する。規則版・バランス指紋の不一致は拒否し、旧版移行や過去エンジンの実行は提供しない。指紋は全ソースコードのハッシュではないため、simの意味を変えた場合は試作規則IDも更新する必要がある。
- 通常StartRecipe/parser、#694の新validator、通常セーブ/parserには依存しない。試作JSONを通常ラン用の形式へ変換しない。`snapshot().rewardsEligible`は常にfalseで、storage呼び出しも報酬の精算APIも持たない。

## 拒否と上限

既存simの0..100という組織値域・既存ID・本番S1規則を使う。一方、次の容量制限と編集範囲は試作独自の制限で、本番仕様ではない。

| 対象 | 上限・拒否条件 |
| --- | --- |
| 入力JSON | 16,384 UTF-16コード単位。JSON.parse前に検査 |
| seed | 空白のみ不可、1..128 UTF-16コード単位 |
| タスク構成 | 1..120件、routine/normal/complexのみ。配列順がタスクID順 |
| 組織値 | testCoverage/documentationのみ、有限な0..100。丸め・clampしない |
| チェックポイント | 20,480 UTF-16コード単位、tick 0..1501、RNG 0..2^32−1の整数 |
| 1回の進行要求 | 1..1501整数tick。実simの完了時点で停止 |
| 入力履歴・保存件数 | セッション履歴/ストレージを持たず、元条件と累積tickだけ保存。tick上限により再計算とtimelineも有限 |

全階層の未知キー、未知ID、未対応版、規則不一致、型違い、欠落、NaN相当のnull・数値オーバーフローによるInfinity、過大件数を理由コードとパス付きで拒否する。未知IDを`getScenario`等へ渡して標準へ落とす経路はない。JSON以外のコードを評価しない。二重開始、無効tick、完了後の進行は盤面・RNG・集中力・予算を変えず拒否する。結果は読み取りから導出し、二重集計・報酬付与を行わない。外へ返す盤面はcloneする。

## 比較と判断

再実行:

```sh
devcontainer exec --workspace-folder . node scripts/ri273-scenario-authoring-evaluation.mjs
devcontainer exec --workspace-folder . npm test -- src/prototypes/scenarioAuthoring.test.ts --maxWorkers=1
```

[比較JSON](./scenario-authoring-comparison.json)に全入力、seed、操作列、初期資源・係数、初期盤面ハッシュ、高価値タスクID、RNG位置付き中間JSON、終端の実結果・費用を残した。3 seed（RI-273:1/2/3）で、基準55/50・規模3種各8件に対し、testCoverageだけ10、documentationだけ10、規模だけ全complexの一要因比較を行った。全12条件で新規実行・途中再開・一括進行後の盤面/RNGが一致した。

| 条件 | 完了tick（seed 1 / 2 / 3） | 出荷値（seed 1 / 2 / 3） |
| --- | --- | --- |
| 基準 | 78 / 78 / 80 | 203 / 380 / 428 |
| testCoverage=10 | 84 / 105 / 120 | 213 / 372 / 271 |
| documentation=10 | 78 / 78 / 78 | 203 / 380 / 369 |
| 全complex | 78 / 78 / 83 | 353 / 405 / 586 |

予算は45で不変、集中力上限13・消費0、メタ報酬0。高価値抽選を含む仕事の進行は実simによる。出荷値は件数ではなく規模等から計算される実指標で、大規模化の数字だけを良い課題の根拠にしない。テストカバレッジ低下で3 seedとも完了が遅くなった一方、出荷値は単調に減らない。ドキュメント低下が結果を変えなかったseedもある。これは初期条件の感度確認であり、楽しさ・人間の適応行動・因果の説明UIの証拠ではない。

次は作者が「レビューを詰まらせる」「テスト不足を対処する」等の狙いを説明できる編集UIを最小で試作し、別の人が条件と制約を理解して実際に対処できるかを観察する。終了条件は、(1) 2項目とタスク内訳を自力で作成・読込できる、(2) 拒否理由から修正できる、(3) 同一課題を受け手が再現できる、(4) 条件変更の狙いと実結果の差を説明できること。ここまで確認して初めて本番統合範囲・公開契約・保存互換・報酬隔離を別Issueへ分割する。

## 検証環境

専用worktree `/private/tmp/devops-tycoon-issue-669`、開始main `56ed9c9253761f3ed8586f6a749eff28bf572863`。標準`.devcontainer/devcontainer.json`を使用。初回はDocker buildxのホスト書込がsandboxに拒否されたため、承認済みの昇格経路で`devcontainer up --workspace-folder .`を再実行し成功した。feature省略やリポジトリ設定の変更はしていない。コンテナ内Nodeはv24.16.0。

対象unit（24件）、型検査を含むbuild、lint、format:checkを実行する。通常UI/Pixiを変更しないためローカルE2E・galleryは対象外。全体unit/coverageとHTML/実WebGL E2E・production chunk recoveryは必須CIで確認する。
