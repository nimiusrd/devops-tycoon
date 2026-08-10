このリポジトリでは特に指定がない限り日本語で記述・回答してください。

変更をコミットまたはPR化する前に、CIで失敗しやすい `npm run lint` と `npm run format:check` を事前に実行して確認してください。フォーマット差分がある場合は `npm run format` または対象ファイルへの Prettier 実行で修正してから進めてください。

## 共通の開発環境

- 本プロジェクトは Vite + React 19 + TypeScript + PixiJS のブラウザゲーム（DevOps Tycoon）。バックエンドやDB等の外部サービスは無く、フロントエンド単体で完結する。
- Node 24 必須（`package.json` の `engines` / `.nvmrc`）。
- 標準コマンドは `package.json` の scripts 参照: 開発サーバ `npm run dev`（ポート5174）、ユニット `npm test`（vitest）、E2E `npm run test:e2e`、ビルド `npm run build`。
- 画面の見た目を一括確認するには `npm run gallery`（seed 固定で主要画面を撮影し `gallery/index.html` に一覧を生成。デザイン確認用でコミット対象外）。
- Playwright 管理外の Chromium を使う場合は、`PLAYWRIGHT_CHROMIUM=<実行ファイル>` または `GALLERY_CHROMIUM=<実行ファイル>` を指定する。
- E2E の `@pixi` 視覚回帰テストは通常スキップされる。実行は `npm run test:e2e:pixi`（`PIXI_E2E=1`）が必要で、ベースラインスナップショットに依存する。
- 既定レンダラは PixiJS（WebGL）。`?renderer=dom` で DOM/SVG レンダラへ切り替えられる（WebGL 不可環境は自動フォールバック）。CI 既定の E2E は `renderer=dom` を明示して実 WebGL を回さない。

## Codex / Dev Container 実行環境

- Codex はホスト側の worktree を操作し、プロジェクトのコマンドは `.devcontainer/devcontainer.json` で定義した Dev Container 内で実行する。ホスト側には Docker デーモンと Dev Container CLI（`devcontainer`）が必要。
- Dev Container は Node 24 を使用し、`postCreateCommand` で npm 依存関係と Playwright Chromium をインストールする。Codex のセットアップは `.codex/environments/environment.toml` から `devcontainer up` を実行する。
- Codex からプロジェクトのコマンドを実行するときは `devcontainer exec --workspace-folder . <command>` を使う。Git 操作はホスト側で行う。
- Codex ではコンテナの並列負荷を避けるため、E2E を `devcontainer exec --workspace-folder . npm run test:e2e -- --workers=1` で実行する。ポートも変える場合は `--remote-env PLAYWRIGHT_PORT=<空きポート>` を `npm` より前に追加する。
- E2E のホスト bind やポートが競合する場合は、`PLAYWRIGHT_HOST=127.0.0.1 PLAYWRIGHT_PORT=<空きポート> npm run test:e2e` で上書きする。
- 画面の見た目を一括確認するには `devcontainer exec --workspace-folder . npm run gallery`（seed 固定で主要画面を撮影し `gallery/index.html` に一覧を生成。デザイン確認用でコミット対象外）。

## Cursor Cloud specific instructions

- `.nvmrc` により Node 24 を選択する。実行前に `node --version` が v24 以上であることを確認し、異なる場合は `nvm use 24` または `bash -l` 経由で実行する。
