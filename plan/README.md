# plan/ ドキュメント索引

DevOps Tycoonの現行仕様、設計判断、SPECとの対応、残課題を管理する。
実装途中の手順や完了済み課題の詳細はGit履歴を参照し、このディレクトリには現在の判断に必要な情報だけを残す。

## 読む順番

| ファイル | 用途 |
| --- | --- |
| [`SPEC.md`](../SPEC.md) | 体験要件と受入条件の正本 |
| [probability-model.md](./probability-model.md) | 確率モデル、seed設計、数式、粗粒度進行、検証方法 |
| [balance-ssot-plan.md](./balance-ssot-plan.md) | バランスパラメータSSoTの設計、移行計画、検証方針 |
| [spec-mapping.md](./spec-mapping.md) | SPECと実装の対応、未充足箇所 |
| [remaining-issues.md](./remaining-issues.md) | 未着手・保留課題と完了項目の要約 |
| [playtest-findings.md](./playtest-findings.md) | 実機プレイで洗い出した改善課題（バランス・UI・ポリッシュ） |
| [mutation-remediation.md](./mutation-remediation.md) | ミューテーション改善の方針（実装単位は GitHub Issue） |
| [architecture.md](./architecture.md) | 現在の技術構成と横断規律 |

## 現状

- Vite + React 19 + TypeScript + PixiJSのフロントエンド単体ゲーム。
- `RunEngine`をラン状態の正本とし、seed付き決定論でシミュレーションする。
- 確率モデルの構造と変更規律は[probability-model.md](./probability-model.md)を正とする。
- バランスパラメータSSoTは型付きレジストリ、生成パラメータ表、工程モデル、メンバー・採用まで移行済み（RI-105〜109）。残る領域移行、コンテンツカタログ、代表曲線、ルールセット識別は[RI-104](./remaining-issues.md#ri-104-バランスパラメータssotの導入)で追跡する。設計正本は[balance-ssot-plan.md](./balance-ssot-plan.md)。
- 既定描画はPixiJS。`?renderer=dom`とWebGL不可時はDOM/SVGへフォールバックする。
- IndexedDBにメタ進行、ラン途中セーブ、リプレイを保存する。
- Vitestでロジック、Playwrightで操作・視覚回帰を検証する。
- コアループは実装済み。スプリント時間帯（RI-75）、Nightmare 序盤の AI 依存即死（RI-74）、レビュー凍結の即死 judgment（RI-85）、難易度カーブと固定強手（RI-73 / F-1・F-7）、勝利種別分岐（RI-76 / F-10）は完了。レイアウト基盤（RI-93〜100）は完了。F-3の検証契約（RI-102）は完了。F-8・F-9の反実仮想評価（RI-101）は計測手段を追加済み（既定コホートの合否は未再走）。第23章の残拡張は RI-34 から RI-125〜131 へ切り出し、部門比較（RI-125）、四半期レビュー履歴（RI-126）、開始レシピ共有（RI-127）、診断・KPI時系列（RI-128）、四半期レビューのOKRテンプレート（RI-129）、ステークホルダー別交渉（RI-130）は完了。残は [RI-131](./remaining-issues.md#ri-131-複数四半期ロードマップ) 以降。ミューテーション改善の直近エピック [RI-91](https://github.com/nimiusrd/devops-tycoon/issues/187)（run 30698016740）は完了。次のフルシャード成功 run が出るまで新エピックは採番しない。採番・進捗の正本は GitHub Issue（本ディレクトリに番号予約しない）。一般バックログの全容は[remaining-issues.md](./remaining-issues.md)を参照。

## 確定した設計判断

- 状態管理ライブラリは指定しない。決定論、保存、リプレイ、UI同期を満たすことを要件とする。
- カード、レリック、進化ノードのSPEC内の具体例は方向性であり、実際の数値・条件は`src/data/`を正とする。
- 巨大組織の各チームは独立状態を持つ。全社・部署への横断施策と、特定チームへ入り込む施策の両方を可能にする。
- 外部API、共有バックエンド、オンラインランキングは対象外。共有機能を追加する場合もローカル完結を維持する。

## 運用

- 新しい未充足は[remaining-issues.md](./remaining-issues.md)へ`RI-NN`で追加し、[spec-mapping.md](./spec-mapping.md)も同時更新する。
- 見た目は`npm run gallery`、ロジックは`npm test`、実ブラウザは`npm run test:e2e`で確認する。
- 変更をコミットする前に`npm run lint`と`npm run format:check`を実行する。
