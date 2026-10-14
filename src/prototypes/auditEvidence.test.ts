import { describe, expect, it } from 'vitest';
import {
  applyAuditEvidence as apply,
  chooseAuditAction,
  compareAuditEvidence,
  createAuditEvidence as create,
  summarizeAuditEvidence,
  viewAuditEvidence,
} from './auditEvidence';
import comparison from '../../docs/prototypes/audit-evidence-comparison.json';

describe('RI-254 監査の証拠', () => {
  it('不足する証拠種と負債ゲートの維持を先に示し、選択だけでは証拠を作らない', () => {
    const first = create('RI-254', 'forecast');
    expect(create('RI-254', 'forecast')).toEqual(first);
    const before = structuredClone(first);
    const blank = viewAuditEvidence(first);
    for (let i = 0; i < 8; i++) expect(viewAuditEvidence(first)).toEqual(blank);
    expect(first).toEqual(before);
    expect(apply(first, { type: 'view' })).toBe(first);
    expect(apply(first, { type: 'work' })).toBe(first);
    expect(blank).toMatchObject({
      requiredReview: 1,
      requiredPrevention: 1,
      missing: ['review', 'prevention'],
      qualityUsed: false,
      debtQualityGate: 'kept',
      replacedDebtGate: false,
      choices: ['record', 'ship'],
    });
    expect(blank.forecasts.map((item) => [item.strategy, item.score, item.rushSpent])).toEqual([
      ['record', 16, 0],
      ['ship', 6, 18],
    ]);
    const chosen = apply(first, { type: 'record' });
    expect(chosen).toMatchObject({ strategy: 'record', evidence: [], shipped: 0 });
    expect(apply(chosen, { type: 'ship' })).toBe(chosen);
    expect(viewAuditEvidence(chosen).choices).toEqual([]);
    expect(
      viewAuditEvidence(create('RI-254', 'crunch')).forecasts.map((item) => item.score),
    ).toEqual([0, 10]);
  });

  it('監査が見えている期間は平時記録、出荷機会が一つだけの期間は出荷が上回る', () => {
    const rows = compareAuditEvidence(comparison.seed);
    expect(rows).toEqual(comparison.results);
    const row = (board: string, strategy: string) =>
      rows.find((item) => item.board === board && item.strategy === strategy)!;
    expect(row('forecast', 'record').result).toMatchObject({
      score: 16,
      shipped: 16,
      rushSpent: 0,
      review: 1,
      prevention: 1,
      missing: [],
      qualityUsed: false,
      debtQualityGate: 'kept',
    });
    expect(row('forecast', 'ship').result).toMatchObject({
      score: 6,
      shipped: 24,
      rushSpent: 18,
      review: 1,
      prevention: 1,
    });
    expect(row('crunch', 'ship').result).toMatchObject({ score: 10, shipped: 18, rushSpent: 8 });
    expect(row('crunch', 'record').result).toMatchObject({ score: 0, shipped: 0, rushSpent: 0 });
    expect(row('forecast', 'record').result.score).toBeGreaterThan(
      row('forecast', 'ship').result.score,
    );
    expect(row('crunch', 'ship').result.score).toBeGreaterThan(
      row('crunch', 'record').result.score,
    );
    for (const item of rows) {
      expect(item.result.lost).toBe(false);
      expect(item.result.qualityUsed).toBe(false);
      expect(item.result.debtQualityGate).toBe('kept');
    }
  });

  it('証拠は操作からだけ作り、同じ証拠の再提出は得点にならない', () => {
    let shipping = apply(create('RI-254', 'forecast'), { type: 'ship' });
    for (let i = 0; i < 3; i++) shipping = apply(shipping, { type: 'work' });
    expect(shipping.evidence).toEqual([]);
    expect(viewAuditEvidence(shipping).missing).toEqual(['review', 'prevention']);
    const rushed = apply(shipping, { type: 'audit' });
    expect(rushed.evidence.map((item) => item.source)).toEqual(['rush', 'rush']);
    expect(rushed.qualityUsed).toBe(false);

    let recording = apply(create('RI-254', 'forecast'), { type: 'record' });
    recording = apply(recording, { type: 'work' });
    expect(recording.evidence.map((item) => [item.id, item.kind, item.source])).toEqual([
      ['review-1', 'review', 'record'],
      ['prevention-2', 'prevention', 'record'],
    ]);
    expect(viewAuditEvidence(recording).missing).toEqual([]);
    const again = apply(recording, { type: 'work' });
    expect(again.evidence).toHaveLength(2);
    const id = recording.evidence[0]?.id ?? '';
    const once = apply(recording, { type: 'submit', id });
    expect(once).toMatchObject({ acceptedReview: 1, acceptedPrevention: 0, submitted: [id] });
    expect(apply(once, { type: 'submit', id })).toBe(once);
  });

  it('全入力の再生と毎入力JSON保存再開が一致し、元状態は変わらない', () => {
    for (const row of compareAuditEvidence(comparison.seed)) {
      let live = row.initial;
      let saved = structuredClone(live);
      for (const input of row.inputs) {
        const previous = live;
        const before = structuredClone(live);
        expect(chooseAuditAction(previous, row.strategy)).toEqual(input);
        live = apply(live, input);
        saved = apply(JSON.parse(JSON.stringify(saved)), input);
        expect(previous).toEqual(before);
        expect(saved).toEqual(live);
        expect(new Set(live.submitted).size).toBe(live.submitted.length);
      }
      expect(summarizeAuditEvidence(live)).toEqual(row.result);
      const sources = new Set(live.evidence.map((item) => item.source));
      expect(sources).toEqual(row.strategy === 'record' ? new Set(['record']) : new Set(['rush']));
    }
  });
});
