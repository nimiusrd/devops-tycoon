/**
 * 育成メンバーの状態 → 現場キャラ表情の写像（RI-08 / SPEC §12.2）。
 *
 * sim 層の `memberExpression`（スタミナ比・休職から leave/tired/great/normal を導く）
 * をレーン配属ごとに集計し、盤面ステーションの表情上書き（`StationMoodOverrides`）へ
 * 変換する純関数。描画は状態を読むだけ（第22.2）なので Vitest で検証できる（第22.5）。
 */
import { memberExpression } from '../sim/member';
import type { LaneAssignment, RosterState } from '../sim/member/types';
import type { StationMoodOverrides } from './boardScene';

/** 表情上書きの対象レーン（メンバーが配属されるのは coding / review のみ）。 */
const MEMBER_LANES: readonly Extract<LaneAssignment, 'coding' | 'review'>[] = ['coding', 'review'];

/**
 * ロスターからレーン別の表情上書きを導く。
 *
 * レーンごとに配属メンバー（bench は対象外）の expression を集計し:
 * - 半数以上が休職（leave）→ `exhausted`（疲れ果て。閉じ目＋汗）
 * - 休職＋疲労（leave+tired）が半数以上 → `tired`
 * - 過半が絶好調（great）→ `cheer`（ガッツポーズ）
 * - それ以外・配属ゼロ → 上書きなし（盤面由来の表情のまま）
 * panic（渋滞・炎上）との優先関係は `mergeStationMood` が持つ（panic が常に勝つ）。
 */
export function deriveMemberMoodOverrides(roster: RosterState): StationMoodOverrides {
  const overrides: StationMoodOverrides = {};
  for (const lane of MEMBER_LANES) {
    const assigned = roster.members.filter((m) => m.assignment === lane);
    const n = assigned.length;
    if (n === 0) continue;
    let leave = 0;
    let tired = 0;
    let great = 0;
    for (const m of assigned) {
      const expr = memberExpression(m);
      if (expr === 'leave') leave += 1;
      else if (expr === 'tired') tired += 1;
      else if (expr === 'great') great += 1;
    }
    if (leave * 2 >= n) overrides[lane] = 'exhausted';
    else if ((leave + tired) * 2 >= n) overrides[lane] = 'tired';
    else if (great * 2 > n) overrides[lane] = 'cheer';
  }
  return overrides;
}
