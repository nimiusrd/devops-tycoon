import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import { format, resolveConfig } from 'prettier';
import { createServer } from 'vite';

const server = await createServer({
  appType: 'custom',
  logLevel: 'error',
  server: { middlewareMode: true },
});
try {
  const { BuildLaboratory, restoreBuildLaboratory } = await server.ssrLoadModule(
    '/src/prototypes/buildLaboratory.ts',
  );
  const digest = (raw) => createHash('sha256').update(raw).digest('hex');
  function evaluate(config, policy) {
    let lab = new BuildLaboratory(config);
    const attempts = [];
    for (const side of ['coding', 'verification']) {
      const act = (input) => {
        const result = lab.act(side, input);
        attempts.push({ side, tick: lab.view(side).tick, input, result });
        return result;
      };
      assert.equal(act({ type: 'start' }).ok, true);
      // 固定された観測間隔と機械的な入力。人間の適応・面白さの証拠にしない。
      for (let i = 0; i < 36 && !lab.view(side).sprint.complete; i++) {
        if (policy === 'review-support') {
          const run = lab.view(side);
          if (run.sprint.tasks.some((t) => t.incident)) act({ type: 'intervene', id: 'firefight' });
          if (run.sprint.tasks.some((t) => t.lane === 'review'))
            act({ type: 'intervene', id: 'pairReview' });
        }
        const result = lab.advance(side, 10);
        assert.equal(result.ok, true);
        attempts.push({
          side,
          tick: lab.view(side).tick,
          input: { type: 'advance', ticks: 10 },
          result,
        });
        // 片側進行中・他側未開始も含め、RNG位置と全状態を毎回JSON往復する。
        const raw = lab.serialize();
        lab = restoreBuildLaboratory(raw);
        assert.equal(lab.serialize(), raw);
      }
      assert.equal(lab.view(side).sprint.complete, true);
    }
    return {
      config,
      policy,
      attempts,
      commands: Object.fromEntries(
        ['coding', 'verification'].map((side) => [side, lab.view(side).commands]),
      ),
      comparison: lab.compare(),
      finalSaveSha256: digest(lab.serialize()),
    };
  }
  const results = [];
  for (const seed of ['RI-270', 'RI-270:1', 'RI-270:2']) {
    for (const maxTicks of [20, 40, 80]) {
      const config = { seed, maxTicks, budget: 45 };
      const first = evaluate(config, 'passive');
      const repeated = evaluate(config, 'passive');
      assert.deepEqual(repeated, first);
      results.push({
        ...first,
        sameConditionRerun: { matched: true, finalSaveSha256: repeated.finalSaveSha256 },
      });
    }
  }
  // APIで介入が実行できる証拠。感度比較とは分け、全試行と拒否理由も保存する。
  const operationWitness = evaluate({ seed: 'RI-270', maxTicks: 80, budget: 45 }, 'review-support');
  const artifact = {
    generatedBy:
      'devcontainer exec --workspace-folder . node scripts/ri270-build-laboratory-evaluation.mjs',
    baseline: '800199c6ebcc81c4693a48a501d8607cdf9335f6',
    rules: {
      fixture:
        '24件、ID0..23。routine/normal/complexをID%3で8件ずつ、ID%6=5が高価値。初期org/default・AI導入済み・集中力12・予算45・codingSlots6。createSprintの仕事生成分のRNGは消費後に種別/価値を固定する。',
      builds:
        '開始時にcodingはclaude-code、verificationはauto-testをL1で1回取得・実発動。価格/効果/集中力は既存カード定義。追加投資・カード廃止・維持費なし。共通初期値は施策適用前。',
      measurement:
        'stepSprint直前の工程別件数×1tickを積算。処理中/炎上中を含み、同tick内の工程通過や介入直後の滞在時間を測れない。厳密な待ち時間や因果寄与ではない。HP/士気/負債は純差分、集中力は還元前の実消費累計。',
      period:
        '共通のmaxTicksは20/40/80だけ変更。実simの全件処理完了なら早期終了し、未完了は工程を保持したtimeout。実tick数も併記し、異なる観測時間を同じ待ち時間として比較しない。',
      isolation:
        '同条件再実行と毎10tickの両側JSON往復を全件照合。通常メタ/daily/save/replay/storageへの書込みなし。',
    },
    decision:
      '再試作。操作UIと人間プレイ評価は未実施。固定方針の計算結果だけで楽しさ・適応行動・本番採用を判断しない。',
    results,
    operationWitness,
  };
  const filepath = 'docs/prototypes/build-laboratory-comparison.json';
  await writeFile(
    filepath,
    await format(JSON.stringify(artifact), { ...(await resolveConfig(filepath)), filepath }),
  );
  console.table(
    results.flatMap(({ config, comparison }) =>
      ['coding', 'verification'].map((side) => ({
        seed: config.seed,
        maxTicks: config.maxTicks,
        side,
        tick: comparison[side].tick,
        delivered: comparison[side].delivered,
        unfinished: comparison[side].unfinished,
        reviewWipTicks: comparison[side].observedTaskTicks.review,
        hpNet: comparison[side].costs.seniorHpNetChange,
        timedOut: comparison[side].timedOut,
      })),
    ),
  );
  console.log(
    'operation witness',
    operationWitness.comparison.coding.delivered,
    operationWitness.comparison.verification.delivered,
  );
} finally {
  await server.close();
}
