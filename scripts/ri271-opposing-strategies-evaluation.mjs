import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const {
    OpposingStrategies,
    defaultOpposingConfig,
    restoreOpposingStrategies,
    STRATEGY_SIDES,
    OPPOSING_LIMITS,
  } = await server.ssrLoadModule('/src/prototypes/opposingStrategies.ts');
  const { getEvent } = await server.ssrLoadModule('/src/data/events.ts');
  const results = [];
  // 一要因感度: 共通レシピの難易度だけを変える。両側は常に同条件。
  const experiments = ['easy', 'normal', 'hard'].flatMap((difficulty) =>
    ['RI-271', 'RI-271:1', 'RI-271:2'].map((seed) => ({ difficulty, seed, witness: false })),
  );
  experiments.push({ difficulty: 'easy', seed: 'RI-271', witness: true });
  for (const { difficulty, seed, witness } of experiments) {
    const config = defaultOpposingConfig(seed);
    config.recipe.difficulty = difficulty;
    if (witness) config.unlockPool.cards = ['auto-test'];
    let challenge = new OpposingStrategies(config);
    const inputs = { ai: [], human: [] };
    const checkpoints = [];
    const send = (side, command) => {
      const outcome = challenge.command(side, command);
      inputs[side].push({ command, ...outcome });
      return outcome.ok;
    };
    for (const side of STRATEGY_SIDES) {
      send(side, { type: 'start' });
      for (let guard = 0; guard < OPPOSING_LIMITS.commandsPerSide; guard++) {
        const s = challenge.state(side);
        if (s.status !== 'playing' || challenge.view()[side].progress === 'limited') break;
        switch (s.phase) {
          case 'setup':
            send(side, { type: 'begin' });
            break;
          case 'sprint': {
            // 手札は昇順に一度ずつ試す。成功・失敗を含め全入力を保存する。
            for (const index of s.sprint.cardPiles.hand) {
              if (challenge.state(side).status !== 'playing') break;
              send(side, { type: 'play-card', index });
            }
            if (challenge.state(side).phase !== 'sprint') break;
            if (!witness) {
              const action = side === 'ai' ? 'assignTask' : 'pairReview';
              send(side, { type: 'intervene', id: action });
              if (s.sprint.tasks.some((t) => t.incident && t.lane === 'rework'))
                send(side, { type: 'intervene', id: 'firefight' });
              if (side === 'human' && s.sprint.tasks.filter((t) => t.lane === 'review').length >= 6)
                send(side, { type: 'intervene', id: 'interruptReview' });
            }
            send(side, { type: 'advance', ticks: 120 });
            if (!checkpoints.some((row) => row.side === side)) {
              const raw = challenge.serialize();
              const restored = restoreOpposingStrategies(raw);
              if (restored.serialize() !== raw) throw new Error('resume mismatch');
              challenge = restored;
              checkpoints.push({
                side,
                phase: challenge.state(side).phase,
                ticks: challenge.state(side).sprintTick,
                characters: raw.length,
              });
            }
            break;
          }
          case 'result':
            send(side, { type: 'result' });
            break;
          case 'draft':
            send(
              side,
              s.draft?.length ? { type: 'choose-card', id: s.draft[0] } : { type: 'skip-draft' },
            );
            break;
          case 'evolution':
            if (witness)
              for (const id of [
                'review-1',
                'quality-1',
                'dev-1',
                'quality-2',
                'review-2',
                'dev-2',
                'quality-3',
              ])
                send(side, { type: 'evolve', id });
            send(side, { type: 'finish-evolution' });
            break;
          case 'beat': {
            const choices = getEvent(s.beat.eventId).choices;
            const index =
              s.beat.kind === 'judgment'
                ? 0
                : choices.findIndex((c) => !c.outcome.forceLose && !c.outcome.grantRecruit);
            send(side, { type: 'beat', choice: Math.max(0, index) });
            break;
          }
          case 'shop':
            send(side, { type: 'leave-shop' });
            break;
          case 'rest':
            send(side, { type: 'rest', option: 'heal' });
            break;
          case 'recruit':
            send(side, { type: 'recruit', option: 'skip' });
            break;
          case 'quarterReview':
            send(
              side,
              s.quarterReview.outcome === 'missed_adjustable'
                ? { type: 'adjust', id: s.quarterReview.availableAdjustments[0] }
                : { type: 'review' },
            );
            break;
          default:
            throw new Error(`unexpected phase ${s.phase}`);
        }
      }
    }
    const view = challenge.view();
    if (witness && view.human.terminal?.status !== 'won') throw new Error('win witness failed');
    if (restoreOpposingStrategies(challenge.serialize()).serialize() !== challenge.serialize())
      throw new Error('terminal resume mismatch');
    results.push({
      experiment: witness ? 'terminal-win-witness' : 'difficulty-sweep',
      seed,
      difficulty,
      checkpoints,
      inputs,
      comparison: view,
    });
    console.log(
      JSON.stringify({
        seed,
        difficulty,
        experiment: witness ? 'terminal-win-witness' : 'difficulty-sweep',
        progress: [view.ai.progress, view.human.progress],
        ai: view.ai.terminal,
        human: view.human.terminal,
        aiMetrics: view.ai.metrics,
        humanMetrics: view.human.metrics,
        aiCosts: view.ai.costs,
        humanCosts: view.human.costs,
      }),
    );
  }
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri271-opposing-strategies-evaluation.mjs',
    limits: OPPOSING_LIMITS,
    driver:
      '両側は手札を昇順に試す。120tickごとにaiはassignTask、humanはpairReview。炎上時はfirefight、humanはレビュー6件以上でinterruptReviewも試す。ドラフト先頭、進化なし、即敗北/即採用を避けた先頭イベント、休息heal、採用skip、店は退出、目標修正は先頭。aiを終端まで進めてからhumanを開始する。',
    winWitnessDriver:
      '別枠の終端API確認。easy/RI-271、両側の候補プールをauto-testのみへ限定し、介入なし、進化でreview-1→quality-1→dev-1→quality-2→review-2→dev-2→quality-3を毎回試す。他の判断は基本方針と同じ。複数要因を変えたため難易度感度には合算しない。',
    limitation:
      'ホームチームのAI配属と介入制約の比較。固定方針の実sim計算であり、人間の適応行動・楽しさ・本番係数の証拠ではない。人間プレイ未実施。',
    results,
  };
  const filepath = 'docs/prototypes/opposing-strategies-comparison.json';
  await writeFile(
    filepath,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(filepath)), filepath }),
  );
} finally {
  await server.close();
}
