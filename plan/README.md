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
| [mutation-remediation.md](./mutation-remediation.md) | ミューテーション結果に基づくテスト強化（エピック RI + 実装単位 `RI-N-A1`。再計測時は新エピック） |
| [architecture.md](./architecture.md) | 現在の技術構成と横断規律 |

## 現状

- Vite + React 19 + TypeScript + PixiJSのフロントエンド単体ゲーム。
- `RunEngine`をラン状態の正本とし、seed付き決定論でシミュレーションする。
- 確率モデルの構造と変更規律は[probability-model.md](./probability-model.md)を正とする。
- バランスパラメータSSoTは未実装であり、導入順序と判断事項は[balance-ssot-plan.md](./balance-ssot-plan.md)にまとめる。
- 既定描画はPixiJS。`?renderer=dom`とWebGL不可時はDOM/SVGへフォールバックする。
- IndexedDBにメタ進行、ラン途中セーブ、リプレイを保存する。
- Vitestでロジック、Playwrightで操作・視覚回帰を検証する。
- コアループは実装済み。優先度「高」の未着手課題は、オンボーディングとシニア燃え尽きの断絶（RI-67）、四半期レビュー Delivery KPI のスケール不整合（RI-68）など。テスト品質ではミューテーション改善（現行は RI-72。再ベースライン時は新 ID）がある。全容は[remaining-issues.md](./remaining-issues.md)を参照。

## 確定した設計判断

- 状態管理ライブラリは指定しない。決定論、保存、リプレイ、UI同期を満たすことを要件とする。
- カード、レリック、進化ノードのSPEC内の具体例は方向性であり、実際の数値・条件は`src/data/`を正とする。
- 巨大組織の各チームは独立状態を持つ。全社・部署への横断施策と、特定チームへ入り込む施策の両方を可能にする。
- 外部API、共有バックエンド、オンラインランキングは対象外。共有機能を追加する場合もローカル完結を維持する。

## 運用

- 新しい未充足は[remaining-issues.md](./remaining-issues.md)へ`RI-NN`で追加し、[spec-mapping.md](./spec-mapping.md)も同時更新する。
- 見た目は`npm run gallery`、ロジックは`npm test`、実ブラウザは`npm run test:e2e`で確認する。
- 変更をコミットする前に`npm run lint`と`npm run format:check`を実行する。
