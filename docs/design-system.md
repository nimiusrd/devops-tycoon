# DevOps Tycoon デザインシステム制約

この文書は、DevOps Tycoon の UI を人と AI が同じ判断基準で変更するための正本である。見た目を固定するためではなく、プレイヤーが状態と次の操作を迷わず理解できること、HTML UIとPixiJSの状態・操作が整合すること、主要 viewport でレイアウトが壊れないことを守る。

SGDS の AI 向けガイダンスにならい、デザイン判断をトークン、コンポーネント、パターン、利用規則、検証手順として明文化する。スクリーンショットの表面だけを模倣せず、意味を表す名前と再利用可能な実装を優先する。

## 1. 適用範囲と言葉

次の変更ではこの文書を適用する。

- `src/ui/`、`src/render/`、`src/styles.css`、CSS Modules の表示・操作変更
- 色、余白、文字、寸法、レスポンシブ、アニメーション、画像、描画レイヤの変更
- ユーザー向け文言、状態表示、モーダル、グラフ、視覚回帰スナップショットの変更

この文書の「必須」は、例外理由を説明せずに外してはならない制約を指す。「原則」は、既存仕様や局所的な描画要件を優先できるが、変更時に判断理由を説明する規則を指す。

## 2. 正本の優先順位

判断が衝突した場合は、上から順に優先する。

| 優先 | 正本 | 決めること |
| --- | --- | --- |
| 1 | [`SPEC.md`](../SPEC.md) | プレイヤー体験、情報、操作、演出の意図 |
| 2 | この文書 | UI の横断制約、デザイン言語、検証条件 |
| 3 | [`src/render/visualTokens.ts`](../src/render/visualTokens.ts) | DOM/Pixi が共有する色、設計空間、寸法の実行値 |
| 4 | `src/render/*View.ts` とテーマ定義 | 状態から表示へ変換する意味と優先順位 |
| 5 | `src/ui/` の共有部品と `src/styles.css` の共通クラス | 実装済みのコンポーネントとパターン |
| 6 | `gallery/` と視覚回帰画像 | 特定の seed・viewport における確認例 |

スクリーンショットは結果の一例であり、トークンや利用規則の代わりにしない。既存画面同士が食い違う場合は、近い見た目をコピーする前に上位の正本から意図を特定する。

## 3. 変更時の必須制約

### DS-01: ユーザーの判断を起点にする

- 画面やコンポーネントを作る前に、プレイヤーが「何を判断し、次に何をするか」を一文で定義する。
- 情報は `現在の状態 → 原因またはリスク → 実行可能な操作 → 詳細` の順で配置する。
- スプリント中は盤面と介入を主役にし、HUD や説明を追加して盤面を不必要に縮めない。詳細は展開、ツールチップ、リザルトへ段階的に開示する。

### DS-02: トークンを表示値の正本にする

- 新しい意味を持つ色と、DOM/Pixi 間または複数コンポーネントで共有する寸法は `VISUAL_TOKENS` に追加する。
- CSS では `visualTokenCssVariables()` が公開する `--visual-*`、または既存の意味別名 `--text`、`--panel` などを参照する。CSS 側に同じ値を再定義しない。
- Pixi と純 TypeScript の描画計画は `VISUAL_TOKENS` を直接参照する。同じ意味の値を数値や文字列で複製しない。
- 新規・変更する CSS/TSX に、状態色やブランド色の hex、rgb、hsl リテラルを直接追加しない。既存ルールを触る場合も、意味を共有する色はトークンへ移す。
- inline style は進捗幅、座標、深度、実行時計算した CSS custom property など、実行時の動的値だけに使う。静的な装飾はクラスへ置く。

#### トークン階層

`VISUAL_TOKENS` では、値の用途が名前から分かる最も高い階層を使う。

| 階層 | 役割 | このリポジトリの例 |
| --- | --- | --- |
| Raw | 16進色や px などの実値。利用側から直接参照しない | `'#58e0b0'`、`12` |
| Foundation | 複数領域で共有する基礎 | `colors.text`、`spaces.sprint` |
| Semantic | 状態や操作の意味 | `colors.health.healthy`、`colors.interaction.drag` |
| Component | 特定部品の契約 | `colors.bannerTone.hell`、`dimensions.department.banner` |

既存の局所的な図形座標や一度しか使わない装飾寸法まで機械的にトークン化しない。ただし、別レンダラへ同じ意味を渡す時点、または二つ目の利用箇所が生じた時点で共有トークンへ昇格する。

### DS-03: 既存コンポーネントとパターンを先に使う

同じ役割の UI を独自マークアップや別の UI ライブラリで増やさない。実装前に少なくとも次を検索する。

| 用途 | 既存の入口 |
| --- | --- |
| 通常・主要・副次ボタン | `.btn`、`.btn-primary`、`.btn-secondary` と既存画面の状態クラス |
| 小さな状態表示 | `.pill` と tone/state 修飾子 |
| KPI | `Hud`、`Stat`、`RunBar` |
| カード | `CardView`、`DeckBar` と `.card` |
| 固定比率の盤面 | `AspectStage` と `DESIGN_SPACES` |
| スプリントの領域配置 | `SprintLayout` の `header/status/stage/deck/controls` slot |
| ズーム階層 | `Breadcrumb` |
| モーダル相当の画面 | `.result-overlay` と既存の Screen コンポーネント |

既存部品で要件を満たせない場合は、まず variant または composition で拡張する。新しい共有部品は、責務と状態が既存部品と明確に異なる場合、または同じ構造が複数箇所で必要な場合に作る。

### DS-04: デザイン言語を混在させない

- 基調は暖かい暗紫の面、クリーム系の本文、ミント・サン・コーラル・ラベンダー・スカイの高彩度アクセント、丸みのあるパネル、明瞭な境界、アイソメトリックな開発現場である。
- 健全、注意、Review Hell のトーンは既存の semantic token とテーマ変換を使う。色だけで状態を伝えず、ラベル、アイコン、形、文言のいずれかを併記する。
- ゲーム世界の比喩と状態理解に寄与しない汎用 SaaS ダッシュボード風のカード、別系統のグレー/ブルー配色、写実的で統一感のない素材を持ち込まない。
- 一つの領域で主要アクションを複数競合させない。最も重要な操作を一つ強調し、危険操作と副次操作は別の tone にする。

### DS-05: WebGL盤面とHTML UIの意味を一致させる

- CanvasとHTMLで状態判定を重複させず、`src/render/*View.ts` の純粋な表示モデルを共有する。
- 色、設計空間、主要寸法、状態 tone は `VISUAL_TOKENS` を共有する。
- 動的盤面はPixiに統一し、DOM/SVGの代替盤面は作らない。状態名、数値、選択可否、操作結果はHTML UIからも取得できるようにする。
- WebGL準備中・初期化失敗時は自動進行を止める。失敗時は説明と再試行を提示する。表示できないままゲームへ戻さないため、このダイアログはEscapeでは閉じない。
- Canvas 上の操作対象には対応する DOM の名前、説明、フォーカス可能な操作、または同等の代替操作を用意する。
- `AspectStage` の contain 配置と `DESIGN_SPACES` の比率を変更するときは、DOM と Pixi の座標・ヒット領域を同時に確認する。

### DS-06: 主要 viewport で情報と操作を失わない

レイアウト変更は次の viewport を最低限の契約とする。

| 名前 | viewport |
| --- | --- |
| phone-se | 320 × 568 |
| phone | 390 × 844 |
| tablet-portrait | 768 × 1024 |
| desktop-short | 1024 × 768 |
| desktop | 1440 × 900 |

- 意図した横スクロール領域を除き、ページ全体に横スクロールを発生させない。
- 固定高さで内容を切らず、折り返し、縦スクロール、段階的開示の順で解決する。
- `src/ui/responsiveModeCore.ts` の width/height mode を、React の振る舞い分岐の正本にする。局所 CSS の media query は内容に基づく見た目の調整に限定し、新しい全体 breakpoint を重複定義しない。
- sticky なアクションバーや overlay が、フォーカス中の要素や最後の操作を完全に隠さないようにする。
- モバイルでも主要操作、状態の要約、閉じる/戻る導線を削らない。装飾と詳細から縮退する。

### DS-07: 状態を一式で設計する

インタラクティブ要素は、該当する次の状態を実装・確認する。

- default、hover、focus-visible、active、disabled、selected/pressed
- loading、empty、error、success（非同期処理や一覧に該当する場合）
- 長い日本語、0件、上限値、最悪状態、同時に複数警告が出る状態

hover だけに情報や操作を置かない。disabled は見た目だけでなく実際に操作不能にし、理由がプレイヤーに必要ならラベル、`title`、説明文などで伝える。

### DS-08: アクセシビリティを表示仕様に含める

- 操作には可能な限り `button`、`input`、見出し、リスト、`nav` などの native semantics を使う。クリック可能な `div` を作らない。
- すべてのキーボード操作対象に常時判別できる `:focus-visible` を用意する。outline を消す場合は、2 CSS px 相当以上で周囲と 3:1 以上の差がある代替を同じルールに書く。
- 通常文字は背景に対して 4.5:1 以上、大きな文字と UI 境界・状態表示は 3:1 以上を必須とする。
- ポインター対象は 24 × 24 CSS px 以上を必須とし、モバイルの主要操作は 44 × 44 CSS px 以上を原則とする。小さく見せる場合は余白をクリック領域に含める。
- アイコンだけの操作には日本語の accessible name を付ける。装飾は `aria-hidden="true"` とし、重要情報を emoji や色だけに載せない。
- 新規・変更する dialog は名前、初期フォーカス、Tab 移動、Escape または明示的な閉じる操作、閉じた後のフォーカス復帰を確認する。
- 自動更新する短い状態は `aria-live="polite"`、即時対応が必要なエラーだけを assertive 相当にする。連続アニメーションの粒子を読み上げ対象にしない。

### DS-09: 動きは状態変化を説明するために使う

- アニメーションは因果、移動先、成功/失敗、緊急度の理解を助ける場合だけ追加する。
- 新しい CSS animation/transition と Framer Motion の演出には、`prefers-reduced-motion: reduce` で動きを停止または即時化する経路を用意する。
- reduced motion でも情報、結果、操作可能性を失わせない。
- 点滅、揺れ、無限ループを主な情報源にしない。同じ領域で複数の注意喚起アニメーションを競合させない。

### DS-10: 実装と検証を小さく進める

- 大きな画面変更は foundation、共有 component、画面 section の順に分け、一度に一つの視覚責務を変更する。
- 振る舞い、route、保存、シミュレーションは、UI 要件が明示的に必要としない限り変更しない。
- 既存の直接指定を全置換するだけの無関係な大規模移行は行わない。変更した規則から段階的に正本へ寄せる。

## 4. 変更ワークフロー

1. 対象のユーザー判断、画面、状態、viewport、レンダラを列挙する。
2. `VISUAL_TOKENS`、既存コンポーネント、近接する表示モデルとテストを検索する。
3. 新規作成より先に、既存 component/variant/token への対応を決める。
4. loading、empty、disabled、最悪状態、長文など、スクリーンショットに見えない状態を補う。
5. 実WebGLで操作・レイアウト契約を検証し、HTMLの状態要約とキーボード操作も確認する。
6. 変更前後の画面を主要 viewport で比較し、意図しない差分を戻す。

要件に不足がある場合は、勝手な装飾で埋めず、「誰が何を判断する画面か」「非表示状態で何が起きるか」「何を変えてはならないか」を先に明らかにする。

## 5. 検証マトリクス

| 変更 | 必須の検証 |
| --- | --- |
| token、表示モデル、純粋な座標変換 | 対応する Vitest。共有 token は `tests/unit/render/visualTokens.test.ts` |
| React UI、CSS、DOM layout | `npm run lint`、`npm run format:check`、対象 Vitest/E2E |
| スプリント主要領域 | `tests/e2e/sprint-layout.spec.ts` の5 viewport契約 |
| 全社・部署・業界の階層画面 | `tests/e2e/org-scale.spec.ts` の該当 viewport契約 |
| Pixi の見た目・座標・ヒット領域 | 該当する `test:e2e:pixi` 視覚回帰 |
| 複数画面に及ぶ視覚変更 | `npm run gallery` で 1440 × 900 の主要画面を目視 |
| focus、dialog、キーボード操作 | Tab/Shift+Tab/Enter/Space/Escape の手動または Playwright 検証 |
| motion | 通常と reduced motion の両方を確認 |

コミットまたは PR 前の共通チェックは [`AGENTS.md`](../AGENTS.md) に従う。スクリーンショットを更新するときは、差分が仕様変更によるものか、偶発的な崩れかを画像ごとに確認する。

## 6. 既知の移行境界

`src/styles.css` には、トークン整備前からの色・寸法リテラルと画面固有スタイルが残っている。これらは新しい実装例ではなく段階的な移行対象である。

- 既存リテラルがあることを、新しい直接指定の根拠にしない。
- 変更箇所の意味が既存 token に一致するなら、その変更内で token 参照へ置き換える。
- 新しい semantic token が必要なら、DOM/Pixi の利用者と CSS variable mapping、テストを同じ変更で追加する。
- 局所的なイラスト座標や runtime 値を例外にする場合は、共有すべきデザイン判断ではない理由をコードコメントまたは PR 説明へ残す。

## 7. 参照

- [SGDS: AI Introduction](https://www.designsystem.tech.gov.sg/ai/introduction)
- [SGDS: Agent skills](https://www.designsystem.tech.gov.sg/ai/skills)
- [SGDS: Development workflows](https://www.designsystem.tech.gov.sg/ai/development-workflows)
- [SGDS: Prompt tips](https://www.designsystem.tech.gov.sg/ai/prompt-tips)
- [W3C WCAG 2.2 Understanding Docs](https://www.w3.org/WAI/WCAG22/understanding/)
