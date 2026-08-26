---
name: devops-tycoon-design-system
description: DevOps Tycoon の UI を設計・変更・レビューし、visual token、既存コンポーネント、レスポンシブ、DOM/Pixi 同等性、アクセシビリティ、視覚検証の制約を守る。React UI、CSS、描画、レイアウト、motion、画像、ユーザー向け文言の変更時に使用し、sim やデータだけの変更には使用しない。
---

# DevOps Tycoon UI デザイン

UI を編集する前に [`docs/design-system.md`](../../../docs/design-system.md) を最初から最後まで読む。このスキルは作業の入口であり、制約の正本は同文書とする。

## 作業手順

1. プレイヤーが行う判断と次の操作を一文で定義する。
2. 対象の画面、表示状態、viewport、DOM/Pixi renderer、reduced motion への影響を特定する。
3. `src/render/visualTokens.ts`、既存の `src/ui/` component、`src/render/*View.ts`、近接テストを検索する。
4. 新しい markup、CSS、値を作る前に、既存 component、variant、semantic token、layout primitive で構成する。
5. スクリーンショットに見えない disabled、empty、loading、error、長文、最悪状態、keyboard focus を補う。
6. デザインシステム文書の検証マトリクスから、変更に対応する unit/E2E/gallery/Pixi 検証を実行する。

## 出力時の確認

- 変更したユーザー判断、再利用した component/token、対象 renderer/viewport を説明する。
- 新しい token または component を追加した場合は、既存のものでは要件を表現できなかった理由を示す。
- 例外を設けた場合は、制約 ID と局所的である理由を示す。
- 視覚確認を実行できなかった場合は、未確認の画面・viewport・renderer を具体的に残す。
