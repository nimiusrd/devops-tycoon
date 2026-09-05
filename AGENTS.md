このリポジトリでは特に指定がない限り日本語で記述・回答してください。

変更をコミットまたはPR化する前に、CIで失敗しやすい `npm run lint` と `npm run format:check` を事前に実行して確認してください。フォーマット差分がある場合は `npm run format` または対象ファイルへの Prettier 実行で修正してから進めてください。

## UI・デザインシステム

- React UI、CSS、Pixi/DOM描画、レイアウト、アニメーション、画像、ユーザー向け文言を変更する前に、[`docs/design-system.md`](docs/design-system.md)と[`.agents/skills/devops-tycoon-design-system/SKILL.md`](.agents/skills/devops-tycoon-design-system/SKILL.md)を読み、同文書の制約と検証マトリクスに従う。
- 新しい意味を持つ色やDOM/Pixi間で共有する寸法は`src/render/visualTokens.ts`を正本にする。既存の直接指定を、新しい色・寸法リテラルを増やす根拠にしない。
- 視覚変更では、影響する状態とviewportを特定し、HTML UIとWebGLの対象E2Eを実行する。Pixiに触れた場合は該当する視覚回帰、複数画面に及ぶ場合は`npm run gallery`も確認する。

## 共通の開発環境

- 本プロジェクトは Vite + React 19 + TypeScript + PixiJS のブラウザゲーム（DevOps Tycoon）。バックエンドやDB等の外部サービスは無く、フロントエンド単体で完結する。
- Node 24 必須（`package.json` の `engines` / `.nvmrc`）。
- 標準コマンドは `package.json` の scripts 参照: 開発サーバ `npm run dev`（ポート5174）、ユニット `npm test`（vitest）、E2E `npm run test:e2e`、ビルド `npm run build`。
- 画面の見た目を一括確認するには `npm run gallery`（seed 固定で主要画面を撮影し `gallery/index.html` に一覧を生成。デザイン確認用でコミット対象外）。
- Playwright 管理外の Chromium を使う場合は、`PLAYWRIGHT_CHROMIUM=<実行ファイル>` または `GALLERY_CHROMIUM=<実行ファイル>` を指定する。
- E2E は通常実行から実WebGLと `@pixi` 視覚回帰を検証する。`npm run test:e2e:pixi` で描画テストだけを実行できる。ベースラインスナップショットに依存する。
- スプリント・部署・全社の動的盤面は PixiJS（WebGL）に統一する。DOM版への切替は廃止。WebGLの準備中・初期化失敗時は自動進行を止め、失敗時は再試行を案内する。HUD・操作・状態の要約はHTMLを使う。

## Codex / Dev Container 実行環境

- Codex はホスト側の worktree を操作し、プロジェクトのコマンドは `.devcontainer/devcontainer.json` で定義した Dev Container 内で実行する。ホスト側には Docker デーモンと Dev Container CLI（`devcontainer`）が必要。
- Dev Container は Node 24 を使用し、`postCreateCommand` で npm 依存関係と Playwright Chromium をインストールする。Codex のセットアップは `.codex/environments/environment.toml` から `devcontainer up` を実行する。
- Codex からプロジェクトのコマンドを実行するときは `devcontainer exec --workspace-folder . <command>` を使う。Git 操作はホスト側で行う。
- Codex ではコンテナの並列負荷を避けるため、E2E を `devcontainer exec --workspace-folder . npm run test:e2e -- --workers=1` で実行する。ポートも変える場合は `--remote-env PLAYWRIGHT_PORT=<空きポート>` を `npm` より前に追加する。
- E2E のホスト bind やポートが競合する場合は、`devcontainer exec --workspace-folder . --remote-env PLAYWRIGHT_HOST=127.0.0.1 --remote-env PLAYWRIGHT_PORT=<空きポート> npm run test:e2e -- --workers=1` で上書きする。
- 画面の見た目を一括確認するには `devcontainer exec --workspace-folder . npm run gallery`（seed 固定で主要画面を撮影し `gallery/index.html` に一覧を生成。デザイン確認用でコミット対象外）。

## ユニットテスト・カバレッジの再実行手順

- リポジトリルートで実行する。対象テストは `devcontainer exec --workspace-folder . npm test -- <テストファイルのパス> --maxWorkers=1`、全体テストは `devcontainer exec --workspace-folder . npm test -- --maxWorkers=2`、全体テストとカバレッジの前後測定は `devcontainer exec --workspace-folder . npm run test:coverage -- --maxWorkers=2` を使う。
- 測定対象・除外設定は `vitest.config.ts` を正本にする。V8 で `src/**/*.{ts,tsx}` を測定し、型定義とテストを除外する。変更前後は同じ設定・コマンドで測定し、実行コマンド・終了コード・レポートをそれぞれ保存する。全体測定は担当を一人に固定し、個別テストとの同時実行も調整する。
- レポートは `coverage/coverage-summary.json`（全体・ファイル別の集計）、`coverage/coverage-final.json`（未カバー箇所の詳細）、`coverage/index.html`（閲覧用）に生成される。Vitest の既定の clean により出力先は測定時に清掃されるため、前回結果は次の測定前に別の場所へ退避する。今回の実行で生成されたことを確認し、未生成時に古いレポートを代用しない。
- `reportOnFailure: true` のため、レポートが生成されてもテスト成功とは限らない。終了コードとテスト結果を先に確認し、カバレッジは別に判定する。集計 JSON の `total` と対象ファイルについて、statements・branches・functions・lines の covered / total と率を前後比較する。閾値を判定する場合は表示用の丸め値ではなく covered / total を使う。
- ファイルはレポート内の絶対パスからプロジェクトルートを取り除いた `src/...` の相対パスで照合する。対象キーの欠落や JSON の読取失敗を 0% と扱わない。対象が存在して total > 0・covered = 0 なら計測済みの 0%、total = 0 ならその指標は該当なしとし、カバレッジ達成とは扱わない。

## Cursor Cloud specific instructions

- `.nvmrc` により Node 24 を選択する。実行前に `node --version` が v24 以上であることを確認し、異なる場合は `nvm use 24` または `bash -l` 経由で実行する。
