import { describe, expect, it } from 'vitest';
import { formationHistoryView } from '../../../src/render/formationHistoryView';
import type { MemberHistory } from '../../../src/sim/member/types';

describe('編成カードの経歴表示モデル', () => {
  it('同名と別チーム内の同一IDを区別し、発生時の内容と同一スプリント内の順序を保つ', () => {
    const history: MemberHistory = {
      startedAfterSprint: 4,
      events: [
        { kind: 'promotion', teamId: 'dev', id: 'm0', sprintNumber: 5, name: '佐藤', to: 'middle' },
        { kind: 'promotion', teamId: 'ops', id: 'm0', sprintNumber: 5, name: '佐藤', to: 'senior' },
        { kind: 'promotion', teamId: 'dev', id: 'm1', sprintNumber: 5, name: '佐藤', to: 'senior' },
        { kind: 'return', teamId: 'dev', id: 'm0', sprintNumber: 6, name: '旧姓' },
        {
          kind: 'leave',
          teamId: 'dev',
          id: 'm0',
          sprintNumber: 6,
          name: '旧姓',
          reason: 'reorganization',
        },
        {
          kind: 'leave',
          teamId: 'dev',
          id: 'm1',
          sprintNumber: 6,
          name: '佐藤',
          reason: 'exhaustion',
        },
      ],
    };
    const dev = formationHistoryView(history, 'dev');
    expect(dev.startedAfterSprint).toBe(4);
    expect(dev.byMemberId.get('m0')).toEqual([
      { key: '5-promotion', sprintNumber: 5, name: '佐藤', description: '初昇格（ミドル）' },
      { key: '6-return', sprintNumber: 6, name: '旧姓', description: '復帰' },
      { key: '6-leave', sprintNumber: 6, name: '旧姓', description: '休職（組織再編）' },
    ]);
    expect(dev.byMemberId.get('m1')?.map((entry) => entry.description)).toEqual([
      '初昇格（シニア）',
      '休職（スタミナ枯渇）',
    ]);
    expect(formationHistoryView(history, 'ops').byMemberId.get('m0')).toEqual([
      { key: '5-promotion', sprintNumber: 5, name: '佐藤', description: '初昇格（シニア）' },
    ]);
  });

  it('旧リプレイの欠落に出来事や開始を補わず、旧セーブの記録開始だけを引き継ぐ', () => {
    expect(formationHistoryView(undefined, 'dev')).toEqual({
      byMemberId: new Map(),
      startedAfterSprint: 0,
    });
    expect(formationHistoryView({ startedAfterSprint: 4, events: [] }, 'dev')).toEqual({
      byMemberId: new Map(),
      startedAfterSprint: 4,
    });
  });
});
