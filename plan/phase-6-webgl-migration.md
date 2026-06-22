# フェーズ6: WebGL（PixiJS）移行

DOM/SVG レンダラを PixiJS + pixi-viewport へ **局所的に差し替える**作業計画。出典は [`SPEC.md`](../SPEC.md) 第22.4 / 第22.5、[architecture.md](./architecture.md) §4.2 / §4.4、[follow-ups.md](./follow-ups.md) フェーズ5。

> 前提（重要）: 実 WebGL は **CI/Node で回さない**（architecture §4.2）。実ピクセル・性能の検証は実ブラウザでのみ行う。DevContainer の dev サーバ（ポート 5173 フォワード）を**ホスト側ブラウザ**で開けば、GPU 有りで描画・計測できる。Vitest は描画を読まない純TS（シーン計画）だけを検証する。

---

## 1. 方針と完了状態

- 難所（投影 / 深度ソート / 画面外カリング / スプライトプール）は `src/render/iso.ts` に純TSで実装・数値検証済み。Phase 6 ではこれを供給先に、全社マップの DOM/SVG 描画を PixiJS へ局所差し替えした。
- 効果の大きい**全社マップ（チーム島。数百〜数千オブジェクト）**のみ Pixi 化した。スプリント盤面（タスク粒は数十）は DOM/SVG 継続。
- DOM/SVG はフォールバックとして残し、`?renderer=pixi` の opt-in で切替（CI と通常プレイは DOM のまま）。Pixi 専用の視覚回帰は `npm run test:e2e:pixi` で opt-in 実行する。

---

## 2. 実装済み

| 種別 | 追加物 | 役割 |
| --- | --- | --- |
| 依存 | `pixi.js@^8` / `pixi-viewport@^6` | レンダラ実体（package.json / lock 反映済み） |
| 境界 | `src/render/adapters/index.ts` の `RendererAdapter<TState>` | シーンごとに入力型を変えられるよう一般化 |
| 純TS | `src/render/orgScene.ts` `planOrgScene()` / `src/render/orgIslandView.ts` | 全社マップの「何を・どこに・どの順で描くか」と LOD / ラベルを決定。カリング/深度/予算を `iso.ts` に委譲 |
| Pixi | `src/render/adapters/pixiOrgRenderer.ts` `PixiOrgRenderer` | `planOrgScene` + `SpritePool` を WebGL へ反映。pan/zoom/カリング、カード/バッジ/ドット LOD、カメラ同期、スクショ固定を実装 |
| React 接続 | `src/ui/OrgPixiField.tsx` / `src/ui/OrgScreen.tsx` | `?renderer=pixi` のとき全社マップのみ Pixi へ切替。部門チップ / パンくず / 島クリックと viewport を同期 |
| フラグ | `src/render/adapters/selectRenderer.ts` `getRendererKind()` | `?renderer=pixi` のときだけ Pixi（既定 DOM） |
| テスト | `tests/unit/orgScene.test.ts` / `orgIslandView.test.ts` / `orgCamera.test.ts` / `selectRenderer.test.ts` | カリング数 / 予算超過数 / 画家順 / LOD / カメラ bounds / フラグを GPU 無しで検証 |
| 視覚回帰 | `tests/e2e/org-pixi-visual.spec.ts` / `npm run test:e2e:pixi` | 固定 seed + `?renderer=pixi` の Pixi canvas スクリーンショット比較（CI 既定 job 外） |

Phase 6 の詳細なサブフェーズ履歴は [`phase-6b-pixi-visual-parity.md`](./phase-6b-pixi-visual-parity.md) を参照。

---

## 3. 実装済みの接続

1. **マウントと描画ループ**: `getRendererKind()` が `pixi` のとき、`OrgScreen` が DOM の島描画の代わりに `OrgPixiField` を表示し、`PixiOrgRenderer` を lazy init / 状態更新ごとに render / アンマウントで dispose する。
2. **カメラ**: pixi-viewport の可視範囲を `CameraRect` に変換して `planOrgScene` へ渡し、カリングを効かせる。`focusDept` / `focusTeam` / `zoomTo` とビューポートのズーム/パンは `orgCamera.ts` の純TS bounds を介して同期する。
3. **見た目**: チーム島は Container（菱形 + Text 群）で、健全度色、部門色 stroke、プレイヤー ★、炎上 alpha、カード/バッジ/ドット LOD を描き分ける。
4. **性能予算 DoD**: `ORG_SPRITE_BUDGET` 500 と LOD 閾値を固定し、100 / 500 / 1000 件 fixture の Vitest で `culled` / `overBudget` / プール上限を回帰検知する。
5. **視覚回帰**: `PIXI_E2E=1` の opt-in Playwright で、固定 seed + Pixi ticker 停止 + canvas スクリーンショット比較を行う。

---

## 4. 性能予算 DoD（確定）

数百〜数千チームを置いたシーンで計測し、上限を数値で固定した。`planOrgScene` の `culled` / `overBudget` / `sprites.length` と Pixi の実測を突き合わせた。

| 指標 | 目標（確定） | 実測（代表） | 取得元 |
| --- | --- | --- | --- |
| 同時スプライト数 | `spriteBudget` 以内（**500**） | 通常 seed **10** / stress 1000 全可視 **500** | `plan.sprites.length` / Pixi children |
| カリング数 | 可視外は確実に除外 | 通常 seed **0** / stress 1000 viewport **>0** | `plan.culled` |
| 予算超過数 | 0（通常プレイ） | 通常 seed **0** / stress 1000 全可視 **500** | `plan.overBudget` |
| フレーム時間 | < 16.7ms（60fps） | idle ~**16ms**（`seed=zoom-e2e`） | ブラウザ Performance / rAF |
| メモリ | 安定（リーク無し） | 自動計測未実施（手動 DevTools 推奨） | ブラウザ Memory |

---

## 5. 完了の目安（DoD）

- [x] `?renderer=pixi` で全社マップが PixiJS 描画になり、ドリルダウン/ズーム/パンが動く。
- [x] 既定（DOM）と Pixi で操作 E2E が両立し、CI は DOM のまま緑（実 WebGL を回さない）。
- [x] §4 の性能予算が数値で確定し、回帰の歯止め（数値テスト）が入っている。
- [x] Pixi 視覚回帰は opt-in E2E として追加済み。
