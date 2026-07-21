/**
 * 画面ギャラリー撮影スクリプト（デザイン確認用。SPEC 第22.2）。
 *
 * seed 固定でゲームを起動し、タイトル〜ランリザルトまでの主要画面を一括で
 * スクリーンショットして `gallery/` に PNG と一覧 `index.html` を出力する。
 * デザイン改修時に「今の見た目」をすぐ確認・比較するための使い捨て出力で、
 * リポジトリにはコミットしない（.gitignore 済み）。
 *
 * 使い方:
 *   npm run gallery
 * 環境変数:
 *   GALLERY_SEED=xxx        撮影に使う seed（既定: tycoon。勝利リザルトまで到達できる）
 *   GALLERY_DIFFICULTY=xxx  難易度（既定: easy。ランが長く続き撮影できる画面が多い）
 *   GALLERY_OUT=dir         出力先ディレクトリ（既定: gallery）
 *   GALLERY_CHROMIUM=path   Chromium 実行ファイルの明示指定（通常は不要）
 *   GALLERY_RENDERER=dom    DOM/SVG レンダラで撮影（既定はアプリ既定の Pixi）
 */
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative, resolve } from 'node:path';
import { createServer } from 'vite';
import { chromium } from '@playwright/test';

const SEED = process.env.GALLERY_SEED ?? 'tycoon';
// 既定は Pixi（アプリの既定レンダラ）。`GALLERY_RENDERER=dom` で DOM/SVG 版を撮影できる。
const RENDERER = process.env.GALLERY_RENDERER ?? '';
const DIFFICULTY = process.env.GALLERY_DIFFICULTY ?? 'easy';
// 出力先はカレントディレクトリ配下に限定する（再帰削除するため、`..` や
// 絶対パスで作業ツリー外を指されると危険）。
const OUT_ARG = process.env.GALLERY_OUT ?? 'gallery';
const OUT = resolve(OUT_ARG);
const OUT_REL = relative(process.cwd(), OUT);
if (OUT_REL === '' || OUT_REL.startsWith('..') || isAbsolute(OUT_REL)) {
  console.error(
    `GALLERY_OUT はカレントディレクトリ配下のサブディレクトリを指定してください（指定値: ${OUT_ARG}）`,
  );
  process.exit(1);
}
const PORT = 5199;
const VIEWPORT = { width: 1440, height: 900 };
/** ギャラリー出力ディレクトリの目印。これが無い既存ディレクトリは削除しない。 */
const MARKER = '.gallery-output';

/** 撮影済み一覧（index.html 生成用）。 */
const shots = [];
let counter = 0;

// 既存ディレクトリは、このスクリプトが生成したもの（マーカー付き）のみ削除する。
// GALLERY_OUT=src のようにソースディレクトリを誤って指しても消さないための保険。
if (existsSync(OUT)) {
  const entries = await readdir(OUT);
  if (entries.length > 0 && !entries.includes(MARKER)) {
    console.error(
      `GALLERY_OUT の既存ディレクトリ「${OUT_REL}」はギャラリー出力ではないため削除しません。未使用のディレクトリ名を指定してください`,
    );
    process.exit(1);
  }
  await rm(OUT, { recursive: true, force: true });
}
await mkdir(OUT, { recursive: true });
await writeFile(
  join(OUT, MARKER),
  'npm run gallery の出力ディレクトリ（再実行時に削除されます）\n',
);

const server = await createServer({
  // host を明示しないと環境によっては IPv6 の ::1 のみにバインドされ、
  // 127.0.0.1 への接続が ERR_CONNECTION_REFUSED になる。
  server: {
    host: '127.0.0.1',
    port: PORT,
    strictPort: true,
    watch: { ignored: [`**/${OUT_REL}/**`] },
  },
});
await server.listen();
const baseUrl = server.resolvedUrls?.local[0] ?? `http://127.0.0.1:${PORT}/`;

const browser = await chromium.launch({
  executablePath: process.env.GALLERY_CHROMIUM || undefined,
});
const page = await browser.newPage({ viewport: VIEWPORT });
await page.emulateMedia({ reducedMotion: 'reduce' });

/** 遷移アニメの静定を待ってから撮影し、一覧へ登録する。 */
async function snap(name, label) {
  counter += 1;
  const file = `${String(counter).padStart(2, '0')}-${name}.png`;
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${OUT}/${file}` });
  shots.push({ file, label });
  console.log(`📸 ${file}  ${label}`);
}

/** モーダルを開いて撮影し、閉じる。開けない場合はスキップする。 */
async function snapModal(openTestId, panelTestId, closeTestId, name, label) {
  try {
    await page.getByTestId(openTestId).click({ timeout: 3000 });
    await page.waitForSelector(`[data-testid="${panelTestId}"]`, { timeout: 3000 });
    await snap(name, label);
    await page.getByTestId(closeTestId).click({ timeout: 3000 });
  } catch {
    console.warn(`⚠️ ${name}（${label}）はこの状態では開けないためスキップ`);
  }
}

await page.goto(`${baseUrl}?seed=${SEED}${RENDERER ? `&renderer=${RENDERER}` : ''}`);
await page.waitForSelector('[data-testid="title"]');
await snap('title', 'タイトル');

// タイトルから開くメタ画面。
await snapModal('open-meta-shop', 'meta-shop', 'meta-shop-close', 'meta-shop', 'メタショップ');
await snapModal(
  'open-card-collection',
  'card-collection',
  'card-collection-close',
  'card-collection',
  'カードコレクション',
);
await snapModal(
  'open-achievements',
  'achievement-collection',
  'achievement-collection-close',
  'achievements',
  '実績コレクション',
);

// ラン開始。自動進行を止め、以降は手動 step で決定論的に進める。
await page.evaluate(
  ([seed, difficulty]) => {
    const g = window.game;
    g.pause();
    g.startRun(difficulty, [], seed);
  },
  [SEED, DIFFICULTY],
);
await page.waitForSelector('[data-testid="setup"]');
await snap('setup', '編成（Setup）');
await snapModal('open-formation', 'formation', 'formation-close', 'formation', '編成モーダル');

// スプリント中盤の盤面（タスク粒が流れている状態）。スプリントを終わらせて
// しまうとリザルトのオーバーレイが写るため、進行度（Done 数）を見ながら
// 1 秒ずつ進め、盤面が動き出した時点で sprint 中のまま撮影する。
await page.evaluate(() => window.game.beginSetupSprint());
let liveCaptured = false;
for (let i = 0; i < 30 && !liveCaptured; i += 1) {
  const doneCount = await page.evaluate(() => {
    const g = window.game;
    if (g.phase() !== 'sprint') return null;
    g.step(1000);
    return g.phase() === 'sprint' ? (g.getState().sprint?.metrics.doneCount ?? 0) : null;
  });
  if (doneCount === null) break;
  if (doneCount >= 3) {
    await snap('sprint-board', 'スプリント盤面（現場）');
    liveCaptured = true;
  }
}
if (!liveCaptured) {
  console.warn('⚠️ スプリントが撮影前に終了したため、ライブ盤面をスキップ');
}

// ズーム階層（現場 ▸ 全社 ▸ 部署 ▸ 業界）。
const zoomShots = [
  ['company', 'org-screen', 'org-map', '全社マップ'],
  ['department', 'dept-screen', 'dept-view', '部署ビュー'],
  ['industry', 'industry-screen', 'industry', '業界ランキング'],
];
for (const [level, testId, name, label] of zoomShots) {
  await page.evaluate((l) => window.game.zoomTo(l), level);
  await page.waitForSelector(`[data-testid="${testId}"]`);
  await snap(name, label);
}
await page.evaluate(() => window.game.zoomTo('team'));

// ラン後半のフェーズ画面（リザルト・ドラフト・進化・ビート・ショップ・休息・
// 四半期レビュー・勝敗）を、ランを機械的に進めながら初出時に撮影する。
const phaseLabels = {
  result: 'スプリントリザルト',
  draft: 'カードドラフト',
  evolution: '組織進化ツリー',
  beat: 'イベント（ビート）',
  shop: 'ショップ',
  rest: '休息',
  quarterReview: '四半期レビュー',
  won: 'ランリザルト（勝利）',
  lost: 'ランリザルト（敗北）',
};
const seen = new Set(['title', 'setup', 'sprint']);
for (let guard = 0; guard < 300; guard += 1) {
  const st = await page.evaluate(() => {
    const s = window.game.getState();
    return { phase: s.phase, status: s.status };
  });
  if (!seen.has(st.phase) && phaseLabels[st.phase]) {
    seen.add(st.phase);
    await snap(
      st.phase.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`),
      phaseLabels[st.phase],
    );
  }
  if (st.status !== 'playing') break;
  await page.evaluate(() => {
    const g = window.game;
    const s = g.getState();
    switch (s.phase) {
      case 'setup':
        g.beginSetupSprint();
        break;
      case 'sprint':
        g.step(1_000_000);
        break;
      case 'result':
        g.acknowledgeResult();
        break;
      case 'draft':
        if (s.draft && s.draft.length > 0) g.chooseCard(s.draft[0]);
        else g.skipDraft();
        break;
      case 'evolution':
        g.finishEvolution();
        break;
      case 'beat':
        g.resolveBeat(s.beat?.kind === 'judgment' ? undefined : 0);
        break;
      case 'shop':
        g.leaveShop();
        break;
      case 'rest':
        g.restChoose('heal');
        break;
      case 'quarterReview': {
        g.acknowledgeQuarterReview();
        if (g.phase() === 'quarterReview') {
          const adjustments = g.getState().quarterReview?.availableAdjustments ?? [];
          if (adjustments.length > 0) g.chooseGoalAdjustment(adjustments[0]);
        }
        break;
      }
      default:
        break;
    }
  });
}

// 一覧ページ（コンタクトシート）。
const items = shots
  .map(
    ({ file, label }) => `      <figure>
        <a href="${file}"><img src="${file}" alt="${label}" loading="lazy" /></a>
        <figcaption>${file.slice(0, 2)}. ${label}</figcaption>
      </figure>`,
  )
  .join('\n');
await writeFile(
  `${OUT}/index.html`,
  `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>DevOps Tycoon 画面ギャラリー</title>
  <style>
    body { margin: 2rem; font-family: system-ui, sans-serif; background: #14122b; color: #eee; }
    h1 { font-size: 1.4rem; }
    p.meta { color: #9a93c9; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(420px, 1fr)); gap: 1.5rem; }
    figure { margin: 0; }
    img { width: 100%; border-radius: 8px; border: 1px solid #3c3766; display: block; }
    figcaption { margin-top: 0.4rem; font-size: 0.85rem; color: #c9c3f0; }
  </style>
</head>
<body>
  <h1>DevOps Tycoon 画面ギャラリー</h1>
  <p class="meta">seed: <code>${SEED}</code> ・ 撮影日時: ${new Date().toISOString()} ・ ${shots.length} 画面</p>
  <div class="grid">
${items}
  </div>
</body>
</html>
`,
);

await browser.close();
await server.close();
// won/lost はどちらか一方にしか到達しないため、片方が撮れていれば未到達扱いにしない。
const missed = Object.keys(phaseLabels).filter(
  (p) => !seen.has(p) && !(p === 'won' && seen.has('lost')) && !(p === 'lost' && seen.has('won')),
);
if (missed.length > 0) {
  console.log(
    `ℹ️ この seed では到達しなかった画面: ${missed.join(', ')}（GALLERY_SEED を変えると撮影できることがあります）`,
  );
}
console.log(`✅ ${shots.length} 画面を ${OUT}/ へ出力（${OUT}/index.html で一覧表示）`);
