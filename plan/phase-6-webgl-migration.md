# フェーズ6: WebGL（PixiJS）移行

DOM/SVG レンダラを PixiJS + pixi-viewport へ **局所的に差し替える**作業計画。出典は [`SPEC.md`](../SPEC.md) 第22.4 / 第22.5、[architecture.md](./architecture.md) §4.2 / §4.4、[follow-ups.md](./follow-ups.md) フェーズ5。

> 前提（重要）: 実 WebGL は **CI/Node で回さない**（architecture §4.2）。実ピクセル・性能の検証は実ブラウザでのみ行う。DevContainer の dev サーバ（ポート 5173 フォワード）を**ホスト側ブラウザ**で開けば、GPU 有りで描画・計測できる。Vitest は描画を読まない純TS（シーン計画）だけを検証する。

---

## 1. 方針

- 難所（投影 / 深度ソート / 画面外カリング / スプライトプール）は `src/render/iso.ts` に純TSで実装・数値検証済み。残りは「`iso.ts` を供給先に、DOM/SVG を PixiJS へ差し替える」局所作業。
- まず効果の大きい**全社マップ（チーム島。数百〜数千オブジェクト）**を Pixi 化する。スプリント盤面（タスク粒は数十）は後続でよい。
- DOM/SVG は当面フォールバックとして残し、`?renderer=pixi` の opt-in で切替（CI と通常プレイは DOM のまま）。

---

## 2. この環境で済ませた下ごしらえ（committed）

| 種別 | 追加物 | 役割 |
| --- | --- | --- |
| 依存 | `pixi.js@^8` / `pixi-viewport@^6` | レンダラ実体（package.json / lock 反映済み） |
| 境界 | `src/render/adapters/index.ts` の `RendererAdapter<TState>` | シーンごとに入力型を変えられるよう一般化（後方互換） |
| 純TS | `src/render/orgScene.ts` `planOrgScene()` | 全社マップの「何を・どこに・どの順で描くか」。カリング/深度/予算を `iso.ts` に委譲 |
| 骨組み | `src/render/adapters/pixiOrgRenderer.ts` `PixiOrgRenderer` | `RendererAdapter` 実装。`planOrgScene` + `SpritePool` を WebGL へ反映（init は lazy） |
| フラグ | `src/render/adapters/selectRenderer.ts` `getRendererKind()` | `?renderer=pixi` のときだけ Pixi（既定 DOM） |
| テスト | `tests/unit/orgScene.test.ts` / `selectRenderer.test.ts` | カリング数 / 予算超過数 / 画家順 / 色 / フラグを GPU 無しで検証 |

全て `npm run build` / `npm test` / `npm run lint` / `npm run format:check` 緑。`PixiOrgRenderer` はまだ React ツリーへ未接続（typecheck はされるがバンドルには未投入）。

---

## 3. ローカル（DevContainer）で詰める手順

1. **マウントと描画ループ**: 全社マップ画面（`src/ui/OrgScreen.tsx` 付近）で `getRendererKind()` が `pixi` のとき、DOM の島描画の代わりに `<div ref>` を用意し、`new PixiOrgRenderer({ iso, spriteBudget, onFocusTeam })` → `await init(mount)` → 状態更新ごとに `render({ teams, camera })`。`dispose()` をアンマウントで呼ぶ。
2. **カメラ**: pixi-viewport の可視範囲を `CameraRect` に変換して `planOrgScene` へ渡し、カリングを効かせる。`focusDept` / `focusTeam` / `zoomTo`（`window.game`）とビューポートのズーム/パンを接続。
3. **見た目**: 仮 Graphics ダイヤ → 健全度別スプライト/テクスチャ。炎上(`fire`)・渋滞の演出（点滅・パーティクル・延焼）。プレイヤーチーム（★）の強調。
4. **性能予算 DoD の確定**（§4）。
5. **視覚回帰**: seed 固定＋一時停止での固定フレーム比較を Playwright に追加するか判断（follow-ups フェーズ5）。`?renderer=pixi&seed=...` で再現。

---

## 4. 性能予算 DoD（ローカルで計測して埋める）

数百〜数千チームを置いたシーンで計測し、上限を数値で固定する。`planOrgScene` の `culled` / `overBudget` / `sprites.length` と Pixi の実測を突き合わせる。

| 指標 | 目標（確定） | 実測（代表） | 取得元 |
| --- | --- | --- | --- |
| 同時スプライト数 | `spriteBudget` 以内（**500**） | 通常 seed **10** / stress 1000 全可視 **500** | `plan.sprites.length` / Pixi children |
| カリング数 | 可視外は確実に除外 | 通常 seed **0** / stress 1000 viewport **>0** | `plan.culled` |
| 予算超過数 | 0（通常プレイ） | 通常 seed **0** / stress 1000 全可視 **500** | `plan.overBudget` |
| フレーム時間 | < 16.7ms（60fps） | idle ~**16ms**（`seed=zoom-e2e`） | ブラウザ Performance / rAF |
| メモリ | 安定（リーク無し） | 自動計測未実施（手動 DevTools 推奨） | ブラウザ Memory |

---

## 5. 完了の目安（DoD）

- `?renderer=pixi` で全社マップが PixiJS 描画になり、ドリルダウン/ズーム/パンが動く。
- 既定（DOM）と Pixi で操作 E2E が両立し、CI は DOM のまま緑（実 WebGL を回さない）。
- §4 の性能予算が数値で確定し、回帰の歯止め（数値テスト）が入っている。
