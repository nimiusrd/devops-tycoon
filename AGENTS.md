このリポジトリでは特に指定がない限り日本語で記述・回答してください。

変更をコミットまたはPR化する前に、CIで失敗しやすい `npm run lint` と `npm run format:check` を事前に実行して確認してください。フォーマット差分がある場合は `npm run format` または対象ファイルへの Prettier 実行で修正してから進めてください。

## Codex / Cursor Cloud 実行環境

- 本プロジェクトは Vite + React 19 + TypeScript + PixiJS のブラウザゲーム（DevOps Tycoon）。バックエンドやDB等の外部サービスは無く、フロントエンド単体で完結する。
- Node 24 必須（`package.json` の `engines` / `.nvmrc`）。Codex の新規 worktree では `.codex/environments/environment.toml` が依存関係と Playwright Chromium をセットアップする。
- PATH 上の `node` が v24 未満の場合は、固定パスを仮定せず `bash .codex/scripts/run-with-node24.sh <command> [args...]` を使う。このラッパーは `.nvmrc` を読む nvm、次に Homebrew の `node@24` を選択する。
- 標準コマンドは `package.json` の scripts 参照: 開発サーバ `npm run dev`（ポート5174）、ユニット `npm test`（vitest）、E2E `npm run test:e2e`（Playwright / Chromium 必要）、ビルド `npm run build`。並行 worktree などで E2E のポートが競合する場合は `PLAYWRIGHT_PORT=<空きポート> npm run test:e2e` を使う。
- 画面の見た目を一括確認するには `npm run gallery`（seed 固定で主要画面を撮影し `gallery/index.html` に一覧を生成。デザイン確認用でコミット対象外。Chromium の場所が特殊な環境では `GALLERY_CHROMIUM=<実行ファイル>` を指定）。
- E2E も同様に、Playwright 管理外の Chromium しか無い環境では `PLAYWRIGHT_CHROMIUM=<実行ファイル>` を指定して実行する（`playwright.config.ts` が対応済み。例: `PLAYWRIGHT_CHROMIUM=/opt/pw-browsers/chromium npm run test:e2e`）。
- E2E の `@pixi` 視覚回帰テストは通常スキップされる。実行は `npm run test:e2e:pixi`（`PIXI_E2E=1`）が必要で、ベースラインスナップショットに依存する。
- 既定レンダラは PixiJS（WebGL）。`?renderer=dom` で DOM/SVG レンダラへ切り替えられる（WebGL 不可環境は自動フォールバック）。CI 既定の E2E は `renderer=dom` を明示して実 WebGL を回さない。
