# 確率モデル

DevOps Tycoonの確率モデルについて、現行実装の構造、数式、seed設計、検証方法をまとめる。
体験要件は[`SPEC.md`](../SPEC.md)、個々の係数とデータは`src/sim/`と`src/data/`の実装を正とする。
係数をゲームとドキュメントで共有するSSoTは未実装であり、設計と段階的な導入手順は[balance-ssot-plan.md](./balance-ssot-plan.md)にまとめる。

## 1. モデルの位置づけ

本作のモデルは、実データから学習した予測モデルではない。開発組織の因果関係をゲームとして体験できるよう、手調整した確率式、処理レート、重み付き抽選、決定論的な閾値判定を組み合わせたシミュレーションである。

中心に置く因果は次のとおり。

- AI利用はCodingを速める。
- CodingがReview能力を上回ると行列が伸びる。
- AI依存度が高く、AIリテラシーや品質が低いとReworkが増える。
- テストカバレッジが低いとIncidentが増える。
- ReviewとIncident対応はシニアを消耗させ、Review能力をさらに下げる。
- カード、レリック、編成、難易度、試練、組織施策は、これらの率やレートを補正する。

処理の概念図は次のとおり。

```mermaid
flowchart LR
    state["現在状態"] --> rates["レート計算"]
    input["プレイヤー入力"] --> rates
    state --> probabilities["確率・重み計算"]
    input --> probabilities
    state --> thresholds["閾値判定"]
    rates --> progress["工程の進行"]
    probabilities --> rng["seed付きPRNG"]
    rng --> event["事象の選択"]
    thresholds --> judgment["KPI・勝敗・診断"]
    progress --> next["次の状態"]
    event --> next
    judgment --> next
```

中核となるフィードバックループは次のように読める。

```mermaid
flowchart LR
    ai["AIを配る"] -->|加速| coding["Coding完了"]
    coding -->|流入増| queue["Review行列"]
    queue -->|消耗| hp["シニアHP低下"]
    hp -->|処理量低下| queue
    ai --> dependency["AI依存度"]
    dependency -->|確率上昇| rework["Rework"]
    literacy["AIリテラシー"] -->|確率低下| rework
    quality["Quality"] -->|確率低下| rework
    coverage["Test Coverage"] -->|確率低下| incident["Incident"]
    incident -->|Reviewを妨害| queue
    intervention["介入・施策"] -->|ループを緩和| queue
    intervention --> rework
    intervention --> incident
```

「確率的であること」と「再現可能であること」は両立する。同じseed、同じ開始状態、同じ入力列なら同じ乱数列を消費し、同じ結果になる。異なるseedを多数試すことで、モデルが持つ結果分布を観測する。

## 2. 実装の正本

| 領域 | 主な正本 |
| --- | --- |
| PRNGとseed変換 | [`src/sim/rng.ts`](../src/sim/rng.ts) |
| 詳細スプリントの確率・レート | [`src/sim/model/process.ts`](../src/sim/model/process.ts) |
| 詳細スプリントの状態遷移 | [`src/sim/sprint.ts`](../src/sim/sprint.ts) |
| 編成による補正 | [`src/sim/member/roster.ts`](../src/sim/member/roster.ts) |
| カード効果とドラフト | [`src/sim/cards.ts`](../src/sim/cards.ts)、[`src/data/cards.ts`](../src/data/cards.ts) |
| 状態依存イベント | [`src/sim/run/events.ts`](../src/sim/run/events.ts)、[`src/data/events.ts`](../src/data/events.ts) |
| ラン進行と派生seed | [`src/sim/run/engine.ts`](../src/sim/run/engine.ts) |
| 独立チームと粗粒度進行 | [`src/sim/orgscale/teamState.ts`](../src/sim/orgscale/teamState.ts) |
| what-if試算 | [`src/sim/run/whatIf.ts`](../src/sim/run/whatIf.ts) |
| KPI、勝敗、診断 | [`src/sim/run/quarterReview.ts`](../src/sim/run/quarterReview.ts)、[`src/sim/outcome.ts`](../src/sim/outcome.ts)、[`src/sim/diagnosis.ts`](../src/sim/diagnosis.ts) |

## 3. PRNGと決定論

### 3.1 PRNG

文字列seedをFNV-1aで32bit整数に変換し、`mulberry32`で`[0, 1)`の擬似乱数列を生成する。シミュレーション層は`Math.random()`を使わず、`Rng`を引数で受け取るか、用途別の派生seedから`createRng`を生成する。

UI演出の位置ずらしなど、ゲーム結果へ影響しない乱数はこの契約の対象外である。

### 3.2 派生seed

一つの乱数列へすべてを接続せず、用途ごとに安定した文字列キーを作る。代表例は次のとおり。

| 用途 | 派生seedの形 |
| --- | --- |
| 初期ロスター | `{seed}:roster` |
| 四半期ボス | `{seed}:boss:q{quarter}` |
| スプリント | スプリントIDを含む専用seed |
| 手札 | `{seed}:deal:{sprintId}` |
| 成長・休職 | `{seed}:growth:{sprintId}` |
| ドラフト | `{seed}:draft:{sprintsPlayed}` |
| ビート | `{seed}:beat:q{quarter}:s{index}` |
| ショップ | `{seed}:shop:q{quarter}:s{index}` |
| チーム初期化 | `{seed}:team:{deptId}:{teamIndex}` |
| 粗粒度進行 | `{seed}:coarse:{stepKey}:{teamId}` |
| what-if | `{baseSeed}:what-if:{trialIndex}` |

これにより、例えばドラフト画面を開くタイミングが変わってもスプリント中の乱数列を消費しない。一方、同一ストリーム内で乱数を消費する順序は結果の一部である。既存ストリームへ判定を追加・並べ替えすると固定seedの結果が変わるため、意図しない場合は新しい派生seedへ分離する。

## 4. 詳細スプリント

選択中チームは、タスク単位の固定タイムステップでシミュレーションする。1 tickはシミュレーション上の離散時間であり、描画フレームレートから独立している。

以下で`clamp(x, a, b)`は、`x`を`a`以上`b`以下へ収める操作を表す。

```mermaid
flowchart LR
    backlog["Backlog"] --> coding["Coding"]
    coding --> review["Review"]
    review -->|"pIncident"| burning["Incident・炎上"]
    review -->|"(1-pIncident) × pRework"| rework["Rework"]
    review -->|"残り"| done["Done"]
    rework --> review
    burning -->|"鎮火"| rework
    burning -->|"時間切れ・HP不足"| spread["延焼"]
    spread --> rework
    spread -.->|"次のPRへ着火"| burning
```

### 4.1 タスク生成

スプリント開始時に各タスクを独立に生成する。

| 項目 | 分布 |
| --- | --- |
| `routine` | 30% |
| `normal` | 45% |
| `complex` | 25% |
| 高価値タスク | 12% |

高価値判定はタスク種別と独立で、高価値タスクの出荷ポイントは通常の3倍になる。

### 4.2 AI利用とCoding

AIを使う確率は次のとおり。

```text
AI利用確率 = 0.85 × AIを配った稼働コーダーの割合
```

AI未導入なら常に0となる。AIを配ったコーダーがいなければ、組織全体のAI依存度が高くてもAI利用タスクは発生しない。

標準規模のCoding所要時間は7 tickで、タスク規模、AI利用、カード、編成で変わる。

```text
Coding所要tick =
  7 × タスク規模倍率
  ÷ AI速度倍率
  ÷ Coding速度補正
  ÷ routine補正
```

- タスク規模倍率: `routine=0.7`、`normal=1`、`complex=1.7`
- AI速度倍率: AI利用時`2.6`、非利用時`1`
- AI利用タスク1件につきAI依存度が`2.2`増える

Coding自体の進捗は確率ではなくレート計算である。

### 4.3 Review能力

Reviewの1 tickあたり処理量は次のとおり。

```text
Review/tick =
  0.9
  × (0.3 + 0.7 × seniorHp / 100)
  × Review効率補正
  × Review容量補正
```

シニアHPが下がるほどReviewが遅くなるが、HP 0でも基礎の30%は残る。Review 1件につきシニアHPを`1.6`消費する。炎上中はReview速度が`0.65`倍、HP自然回復が`0.5`倍になる。

### 4.4 Incident

Review時、最初にIncidentを判定する。

```text
pIncident =
  clamp(
    (
      0.02
      + 0.10 × (1 - testCoverage / 100)
      + AI利用時 0.05 × (1 - aiLiteracy / 100)
    )
    × Incident倍率,
    0.01,
    0.40
  )
```

テストカバレッジが低いほど増え、AI利用タスクではAIリテラシー不足が追加リスクになる。カード、レリック、編成、難易度、試練は`Incident倍率`へ合流する。

Incidentになったタスクは即時に結果確定せず、35 tickの炎上状態へ入る。時間内にプレイヤーが鎮火しなければ、シニアHPが十分な場合は自動鎮火、足りない場合は延焼となる。この後半は閾値とタイマーによる決定論である。

### 4.5 Rework

Incidentにならなかったタスクに対して、Reworkを判定する。

```text
pBase =
  0.05
  + 0.32 × aiDependency / 100
  + AI利用時 0.10
  - 0.18 × aiLiteracy / 100
  - 0.14 × quality / 100
  + Rework加算補正
  - PR分割時 0.16

pRework =
  clamp(pBase × 0.5 ^ reworkAttempts, 0.02, 0.75)
```

手戻りを繰り返すほど確率を半減させ、最大3回で収束させる。`pRework`はIncidentが起きなかった場合の条件付き確率なので、Review1回あたりの無条件Rework確率は概ね次の値になる。

```text
P(Rework) = (1 - pIncident) × pRework
```

代表的な初期条件で変数を一つずつ動かすと、確率は次のように変化する。

![AI依存度とRework確率、Test CoverageとIncident確率の代表曲線](./assets/probability-curves.svg)

グラフは式から直接算出した条件付き確率で、Monte Carloの観測値ではない。読み取り値は次のとおり。
現時点のSVGは実装値をもとに作成したスナップショットである。SSoT導入後は、同じ定義と計算関数から自動生成する。

| 入力 | AI利用あり | AI利用なし |
| --- | ---: | ---: |
| AI依存度 0 → 100でのRework確率 | 2.0% → 30.5% | 2.0% → 20.5% |
| Test Coverage 0 → 100でのIncident確率 | 14.75% → 4.75% | 12.0% → 2.0% |

### 4.6 編成と施策の合成

編成は個体能力を次の補正へ畳み込む。

- コーダーの実装力 → Coding速度、並列枠
- レビュアーのレビュー力と人数 → Review効率、Review容量
- AIを配ったコーダーのAI習熟度とトレイト → Rework加算、Incident倍率
- 稼働シニア人数 → 集中力上限
- AIを配った稼働コーダーの割合 → AI利用確率

カード、レリック、進化、難易度、試練も最終的に同じ`CardEffects`またはランパッシブへ合成する。確率式を機能ごとに分岐させず、共通のモデルへ補正値として入力するのが基本方針である。

### 4.7 成長と休職

経験値、レベルアップ、スタミナ消費は決定論である。スタミナが14以下になったメンバーだけ休職判定を行う。

```text
pLeave = 0.5 × (1 - stamina / 14)
```

スタミナ14では0%、0では50%となる。休職中は回復が速く、スタミナ上限の40%まで戻ると復帰する。

## 5. スプリント間イベントと報酬抽選

### 5.1 ビート種別

各ビートでは、まず55%で選択イベント、45%で判定イベントを選ぶ。該当種別の候補が空なら、もう一方へフォールバックする。

### 5.2 状態信号

組織状態を0〜1の信号へ正規化する。

| 信号 | 算出元 |
| --- | --- |
| `techDebtHigh` | `techDebt / TECH_DEBT_CAP` |
| `aiDependencyHigh` | `aiDependency / 100` |
| `aiLiteracyLow` | `(100 - aiLiteracy) / 100` |
| `seniorHpLow` | `(100 - seniorHp) / 100` |
| `moraleLow` | `(100 - morale) / 100` |
| `qualityLow` | `(100 - quality) / 100` |
| `testCoverageHigh` | `testCoverage / 100` |
| `documentationHigh` | `documentation / 100` |

`minSignal`を満たさないイベントは候補から除外する。これにより、シニアHPが十分な組織でレビュー完全停止のようなハード敗北イベントが起きないようにする。

候補イベントの有効重みは次のとおり。

```text
effectiveWeight =
  baseWeight
  × Π(1 + triggerFactor × signalStrength)
```

例えば技術的負債が高いほど`debt-incident`、AI依存度が高いほど`giant-ai-pr-judgment`、テストが厚いほど`ci-improved`の重みが増える。

現在、`weightedEventPool`が受け取る`RunTotals`は重み計算に使っていない。イベント選択後の効果とプレイヤーが選んだ選択肢の結果は、原則として固定値を適用する。

### 5.3 カードとその他の抽選

ドラフトは重複なしの重み付き抽選である。

| レアリティ | 基礎重み |
| --- | --- |
| Common | 6 |
| Rare | 3 |
| Legendary | 1 |

研修方針で優先したカードは重みを3倍にする。ボス、候補内のレリック、採用アーキタイプなどは、現在の有効候補から一様に選ぶ。

## 6. 独立チームの粗粒度モデル

RI-64以降、各チームは永続的な`TeamRunState`を持つ。選択中チームは第4章の詳細モデルで進行し、それ以外のチームはスプリント完了ごとに1回、粗粒度モデルで進行する。

粗粒度モデルは、すべてのタスクを生成する代わりに、チーム指標を直接更新する近似モデルである。各チーム・各ステップ専用の派生seedを使うため、チーム配列の並びや他チームへの操作で乱数列を共有しない。

```mermaid
flowchart TB
    engine["RunEngine"] --> active["選択中チーム"]
    engine --> others["非選択チーム群"]
    active --> detailed["詳細スプリント<br/>タスク単位・固定tick"]
    others --> coarse["粗粒度進行<br/>チーム単位・スプリント完了時"]
    detailed --> activeState["TeamRunStateへ同期"]
    coarse --> otherStates["各TeamRunStateを更新"]
    activeState --> aggregate["部署・全社へ集約"]
    otherStates --> aggregate
    aggregate --> kpi["RunTotals・四半期KPI"]
```

### 6.1 出荷

稼働人数が0なら出荷は0になる。それ以外では次の近似を使う。

```text
shipGain =
  max(
    4,
    round(
      (
        (8 + engineers × 2.5 + aiLiteracy × 0.08)
        × Uniform(0.75, 1.25)
        - techDebt × 0.02
      )
      × shipMul
    )
  )
```

出荷ポイントは、詳細モデルの通常タスク5ポイントを基準に完了件数へ換算する。AI支援完了数は、推定コーダー数、AI依存度から求めた配布割合、基礎AI利用率85%で按分する。

### 6.2 Review行列

```text
reviewCapacity =
  clamp(55 + engineers × 4 - reviewQueue × 2, 10, 100)

queuePressure =
  max(
    0,
    round(
      engineers × 0.35
      + aiDependency × 0.04
      - adjustedReviewCapacity × 0.05
      - queueRelief
    )
  )
```

行列には乱数差分と`queuePressure`を加え、Review能力に応じた件数を消化する。チーム施策、レリック、試練などは`queueRelief`、`reviewMul`、`reviewCapacityMul`へ合流する。

### 6.3 Incident

チームの炎上バイアスは、現在のIncident数と品質から再計算する。

```text
incidentBias =
  clamp(
    0.08
    + incidents × 0.05
    + (100 - quality) × 0.002,
    0.02,
    0.45
  )

pIgnite =
  clamp(
    (incidentBias + aiDependency × 0.0015)
    × teamFireMul
    × incidentRateMul,
    0.02,
    0.50
  )

pContain =
  min(
    1,
    (0.35 + adjustedReviewCapacity × 0.004)
    × reviewMul
  )
```

同じステップで発火して鎮火しても、発生件数は`ignited`として保持する。全社KPIへ集計するときは、非選択チーム平均の1/2を寄与させ、小数分を`coarseIncidentCarry`へ繰り越す。これは詳細チームと多数の粗粒度チームを単純合算してIncident KPIを崩壊させないためのゲーム上の正規化である。

### 6.4 その他の更新

- 士気: Review行列、未鎮火Incident、施策バイアス、`[-2, 2]`の乱数差分で更新
- 技術的負債: AI依存度で増え、AIリテラシーと返済施策で減る
- AIリテラシー: 40%で`+1`
- AI依存度: 30%に施策圧力を掛けた確率で`+1`し、試練の固定ドリフトも加算
- 品質: 25%で`-1`
- シニアHP: Review行列に応じて消耗し、残量の5%を回復

粗粒度モデルの係数は、詳細モデルと同じ方向の因果を低コストで表現するための近似であり、詳細モデルと同一分布になることは目的としていない。

## 7. 確率を使わない判定

次の領域は、確率抽選ではなく現在状態から一意に決まる。

- Coding、Review、Reworkの進捗レート
- 炎上タイマー後の自動鎮火または延焼
- 出荷ポイントとコンボ倍率
- KPIの`exceeded`、`met`、`missed`
- 四半期outcome
- ボス突破
- 即時敗北条件
- 組織タイプ診断
- カード、イベント、レバーの選択後に適用する固定効果

確率は「不確実な事象」を作るために使い、プレイヤーが選んだ施策の直接効果や、明示した敗北条件まで抽選にしない。

## 8. what-if試算

SetupとDraftでは、同じ開始条件を24個の派生seedで無介入実行し、次の値を表示する。

- 出荷量の平均、最小、最大
- 延焼数の平均、最小、最大
- 開始時またはカード発動時の即時敗北警告

候補比較では同じtrial seed群を使うため、乱数差より施策差を見やすい。表示する最小・最大は24試行の観測範囲であり、信頼区間や理論上の上下限ではない。

スプリント終了後の「無介入ベースライン」も同じ初期条件から再実行する。ただし介入によって本番側の乱数消費順が変わる場合があるため、厳密な反実仮想ではなく同条件での推定として扱う。

## 9. 検証

### 9.1 決定論

- 同じseedと入力列で状態と結果が一致する
- 異なるseedで結果が変わりうる
- 保存・復元後も進行結果が一致する
- チームごとの派生seedと粗粒度進行が再現する

主なテストは[`tests/unit/rng.test.ts`](../tests/unit/rng.test.ts)、[`tests/unit/sprint.test.ts`](../tests/unit/sprint.test.ts)、[`tests/unit/run-engine.test.ts`](../tests/unit/run-engine.test.ts)、[`tests/unit/orgscale-engine.test.ts`](../tests/unit/orgscale-engine.test.ts)。

### 9.2 因果の不変条件

代表的な不変条件は次のとおり。

- AI依存度が上がるとRework確率が単調増加する
- 品質が上がるとRework確率が下がる
- テストカバレッジが上がるとIncident確率が下がる
- AI利用でCodingが速くなる
- AIありはAIなしよりReview行列とReworkが増える
- コーディング偏重編成は均衡編成よりReview行列が増える
- 技術的負債が高いほど負債系イベントの重みが増える
- 粗粒度モデルでもIncident倍率、Review容量、AI依存ドリフトが同じ方向へ効く

主なテストは[`tests/unit/process.test.ts`](../tests/unit/process.test.ts)、[`tests/unit/run-loop.test.ts`](../tests/unit/run-loop.test.ts)、[`tests/unit/member.test.ts`](../tests/unit/member.test.ts)、[`tests/unit/monteCarlo.test.ts`](../tests/unit/monteCarlo.test.ts)。

### 9.3 統計レンジ

固定した代表seed群を使い、勝率、出荷、Rework、Incident、シニアHP、Review行列、介入効果、編成差、AIあり/なし差を許容レンジで監視する。比較テストは同一seedのペアを使い、乱数差を抑えて施策の方向と効果量を測る。

これらは極端なバランス崩壊を検知する回帰テストであり、現実の発生率への適合や統計的有意性を証明するものではない。代表seedは探索で選ばれたものを含むため、全分布の推定には別途、多数seedでの計測が必要である。

## 10. 現在の限界

- 係数は実組織データから校正しておらず、ゲーム上の手触りと因果の分かりやすさを優先している。
- 多くの式は線形加算とclampであり、変数間の相関や長期履歴を限定的にしか表現しない。
- タスク種別と高価値判定は独立で、案件構成の相関を持たない。
- イベント重みは現在の`OrgState`を使うが、`RunTotals`や直近イベント履歴は使わない。
- イベントやカードの選択後結果は原則固定で、成功・失敗の二次抽選はない。
- what-ifは24試行の平均と観測範囲に限られ、分位点や分散、信頼区間は表示しない。
- 粗粒度チームは指標直接更新の近似で、詳細スプリントと同一のタスク分布を再現しない。
- 固定seedの互換性とモデル改善が衝突する場合がある。係数変更時は、再現性の対象を「同じバージョン内」とするか、既存seed結果まで維持するかを変更ごとに判断する。

## 11. 変更時の規律

確率モデルを変更するときは、次を同時に確認する。

1. 変更する因果とプレイヤーへ与えたい判断を先に言語化する。
2. 確率、レート、固定効果、閾値のどれで表現するかを選ぶ。
3. 確率は`[0, 1]`、倍率と状態値は意図した範囲へclampする。
4. シミュレーション層へ`Math.random()`や時刻依存を持ち込まない。
5. 既存の乱数消費順を変える必要がなければ、新しい派生seedへ分離する。
6. 単調性などの因果不変条件をunit testへ追加する。
7. 効果量は同一seedペアと多数seedの両方で確認する。
8. 詳細モデルを変えた場合、粗粒度モデルでも同じ方向の因果が保たれるか確認する。
9. KPIや保存対象へ新しい状態を加えた場合、集約、セーブ、復元、リプレイを更新する。
10. 係数、式、モデル境界が変わった場合は本ドキュメントを更新する。SSoT導入後の更新方法は[balance-ssot-plan.md](./balance-ssot-plan.md)に従う。
