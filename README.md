# DevOps Tycoon

> AIを入れたら最強になると思ったら、レビューが燃えた。

AI導入による開発速度の向上と、レビュー渋滞・手戻り・技術的負債・シニア過労のトレードオフを体験する、ブラウザ向け開発組織シミュレーションゲームです。

![スプリント中の開発組織](tests/e2e/sprint-pixi-visual.spec.ts-snapshots/sprint-pixi-board-chromium-linux.png)

## ゲームについて

プレイヤーは開発組織のマネージャーとして、AIツール、テスト、ドキュメント、レビュー体制、採用などへ投資します。AIはCodingを加速しますが、組織能力が追いつかなければReviewやReworkへ負荷が移ります。

スプリント中は流れてくるタスクへリアルタイムに介入し、スプリント後はカード、組織進化、イベントを通じて次のボススプリントに備えます。目標未達でも組織が継続可能なら、目標と代償を選び直して次四半期へ進みます。

```text
編成
  ↓
スプリント ── リアルタイム介入、カード発動、レビュー渋滞と炎上
  ↓
リザルト ── 原因分析、無介入ベースライン比較、メンバー成長
  ↓
カードドラフト → 組織進化 → イベント
  ↓
四半期末ボス → 四半期レビュー → 勝利 / 目標修正 / 継続不能
```

## 主な機能

- タスクがBacklog、Coding、Review、Rework、Doneを流れるリアルタイム盤面
- 集中力を使う介入アクション、対象指定、コンボ、時限効果
- カードドラフト、手札、強化、レリック、組織進化ツリー
- メンバーの編成、AI配布、成長、疲労、採用
- 四半期目標、ボススプリント、目標修正、複数四半期ラン
- Review Hellなどの組織タイプ診断と「なぜ燃えたか」の振り返り
- 全社、部署、現場、業界ランキングを行き来するズーム階層
- 難易度、試練、実績、カード／レリックのメタ解放
- 同一seedで遊ぶデイリーランと端末内ランキング
- ラン途中セーブ、キーフレームリプレイ、BGM・効果音
- seed付き決定論による再現可能なシミュレーション

データはブラウザのIndexedDBへ保存されます。バックエンドや外部APIは使用しません。ブラウザのサイトデータを削除すると、メタ進行、ラン途中セーブ、リプレイも削除されます。

## クイックスタート

### 必要環境

- Node.js 24以上
- npm
- WebGL対応ブラウザ（利用できない場合はDOM/SVGへ自動フォールバック）

`.nvmrc`を利用する場合:

```bash
nvm use
npm ci
npm run dev
```

ブラウザで [http://localhost:5174](http://localhost:5174) を開きます。

### URLオプション

| パラメータ | 例 | 用途 |
| --- | --- | --- |
| `seed` | `?seed=my-run` | 同じランを再現する |
| `renderer` | `?renderer=dom` | PixiJSではなくDOM/SVGレンダラを使う |
| `tutorial` | `?tutorial=force` | 初回ガイドを再表示する |
| `tutorial` | `?tutorial=off` | 初回ガイドを表示しない |

例:

```text
http://localhost:5174/?seed=review-hell&renderer=dom&tutorial=force
```

## 開発コマンド

| コマンド | 内容 |
| --- | --- |
| `npm run dev` | 開発サーバをポート5174で起動 |
| `npm run build` | TypeScript検査と本番ビルド |
| `npm test` | Vitestのユニットテストを実行 |
| `npm run test:watch` | Vitestをwatchモードで実行 |
| `npm run test:e2e` | Playwrightの標準E2Eを実行 |
| `npm run test:e2e:pixi` | PixiJSの視覚回帰テストを実行 |
| `npm run gallery` | 主要画面を撮影して`gallery/index.html`を生成 |
| `npm run playtest` | 全難易度×方針でランを自動プレイし結果を`playtest-out/`へ出力 |
| `npm run playtest:report` | プレイテスト結果をSPEC第19.1の判定基準ごとに集計 |
| `npm run lint` | ESLintを実行 |
| `npm run format:check` | Prettier差分を確認 |
| `npm run format` | Prettierで整形 |
| `npm run audio:generate` | BGM・効果音アセットを再生成 |

PlaywrightのChromiumが未導入の場合は、先に次を実行します。

```bash
npx playwright install chromium
```

Chromiumの実行ファイルを明示する環境では、`PLAYWRIGHT_CHROMIUM`または`GALLERY_CHROMIUM`を指定できます。

## 技術構成

| 領域 | 技術 |
| --- | --- |
| UI | React 19 / Framer Motion |
| 盤面・カメラ | PixiJS / pixi-viewport |
| 言語・ビルド | TypeScript / Vite |
| 状態・シミュレーション | 純TypeScriptの`RunEngine` / XState遷移契約 |
| 永続化 | IndexedDB / idb |
| 重い試算 | Web Worker / Comlink |
| グラフ | Recharts |
| テスト | Vitest / Playwright |

`RunEngine`をラン状態の正本とし、Reactとレンダラはスナップショットを読んで表示します。シミュレーションは描画と永続化から分離し、同じseedと入力で同じ結果を返します。

## ディレクトリ

```text
src/
├── sim/       # 確率モデル、ラン進行、メンバー、組織集約
├── data/      # カード、レリック、イベント、難易度などの定義
├── state/     # メタ進行、セーブ、リプレイ、IndexedDB
├── render/    # 描画計画とPixiJS / DOMアダプタ
├── ui/        # React画面と操作UI
├── audio/     # BGM・効果音の再生
└── game.ts    # UI・E2E向けの操作ファサード

tests/
├── unit/      # ロジック、不変条件、統計レンジ
├── e2e/       # ブラウザ操作と視覚回帰
└── playtest/  # バランス計測用オートプレイ（npm run playtest。npm test の対象外）
```

## ドキュメント

- [SPEC.md](SPEC.md) — 体験要件と受入条件
- [plan/spec-mapping.md](plan/spec-mapping.md) — SPECと実装の対応
- [plan/remaining-issues.md](plan/remaining-issues.md) — 現在の未充足・保留課題
- [plan/architecture.md](plan/architecture.md) — 技術構成と横断規律
- [plan/README.md](plan/README.md) — 計画文書の索引

## 現在の開発状況

コアループは通しプレイ可能です。現在の主要な未充足は次のとおりです。

- ボス、四半期、ラン全体を含むペーシング統計検証の補強
- 面白さの判定基準（[SPEC 第19.1](SPEC.md)）に対するバランス上の未充足（難易度カーブ、単一介入の優位、勝利種別の分岐、AI 導入の意思決定、カードの寄与）

詳細と受入条件は[残課題バックログ](plan/remaining-issues.md)を参照してください。
