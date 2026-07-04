このリポジトリでは特に指定がない限り日本語で記述・回答してください。

変更をコミットまたはPR化する前に、CIで失敗しやすい `npm run lint` と `npm run format:check` を事前に実行して確認してください。フォーマット差分がある場合は `npm run format` または対象ファイルへの Prettier 実行で修正してから進めてください。

## Cursor Cloud specific instructions

- 本プロジェクトは Vite + React 19 + TypeScript + PixiJS のブラウザゲーム（DevOps Tycoon）。バックエンドやDB等の外部サービスは無く、フロントエンド単体で完結する。
- Node 24 必須（`package.json` の `engines` / `.nvmrc`）。nvm に v24 を導入済みで default も 24 に設定済み。ログインシェル（`bash -l`）なら `node` は自動で v24 になる。
- 注意（gotcha）: 非ログインの素のシェルでは PATH 先頭の `/exec-daemon/node`（v22）が優先されてしまう。その場合は `export PATH="$HOME/.nvm/versions/node/v24.18.0/bin:$PATH"` を先頭に付けるか、`bash -l` 経由でコマンドを実行すること。
- 標準コマンドは `package.json` の scripts 参照: 開発サーバ `npm run dev`（ポート5173）、ユニット `npm test`（vitest）、E2E `npm run test:e2e`（Playwright / Chromium 必要）、ビルド `npm run build`。
- E2E の `@pixi` 視覚回帰テストは通常スキップされる。実行は `npm run test:e2e:pixi`（`PIXI_E2E=1`）が必要で、ベースラインスナップショットに依存する。
