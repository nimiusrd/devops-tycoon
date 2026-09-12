/**
 * Issue #476 研究用の安価なメトリクス表示。本番 UI ではない。
 */
import { useEffect, useRef, useSyncExternalStore } from 'react';
import { formatSprintResultSeniorHp } from '../render/seniorHpDisplay';
import type { SprintResult } from '../sim/types';
import {
  issue476Knobs,
  issue476VariantLabel,
  resolveIssue476VariantFromLocation,
  subscribeIssue476Variant,
  type Issue476Variant,
} from './issue476Experiment';

export interface Issue476DebugHudProps {
  variant?: Issue476Variant;
  sprintNumber?: number;
  result?: SprintResult | null;
  taskCount?: number;
  seniorHp?: number;
}

function completionRatePct(done: number, taskCount: number | undefined): string {
  if (!taskCount || taskCount <= 0) return '—';
  return `${((done / taskCount) * 100).toFixed(1)}%`;
}

function dumpLine(props: Issue476DebugHudProps): string {
  const knobs = issue476Knobs(props.variant);
  const result = props.result;
  const parts = [
    `[#476 ${issue476VariantLabel(knobs.variant)}]`,
    `S-bar=${knobs.gradeThresholdS}`,
    `easyFloor=${knobs.easyNormalTaskFloor}`,
    `easyMul=${knobs.easyTaskCountMul}`,
  ];
  if (props.sprintNumber !== undefined) {
    parts.push(`sprint=${props.sprintNumber}`);
  }
  if (result) {
    parts.push(
      `rank=${result.grade}`,
      `delivered=${result.delivered}`,
      `done=${result.done}/${props.taskCount ?? '?'}`,
      `complete=${completionRatePct(result.done, props.taskCount)}`,
      `seniorHpEnd=${props.seniorHp ?? formatSprintResultSeniorHp(result)}`,
      `reviewWaitMax=${result.reviewQueueMax}`,
    );
  }
  return parts.join(' ');
}

export function Issue476DebugHud({
  variant,
  sprintNumber,
  result,
  taskCount,
  seniorHp,
}: Issue476DebugHudProps) {
  const liveVariant = useSyncExternalStore(
    subscribeIssue476Variant,
    resolveIssue476VariantFromLocation,
    () => 'baseline' as const,
  );
  const knobs = issue476Knobs(variant ?? liveVariant);
  const lastDump = useRef<string>('');

  useEffect(() => {
    const line = dumpLine({
      variant: variant ?? liveVariant,
      sprintNumber,
      result,
      taskCount,
      seniorHp,
    });
    if (line === lastDump.current) return;
    lastDump.current = line;
    console.info(line);
  }, [variant, liveVariant, sprintNumber, result, taskCount, seniorHp]);

  return (
    <aside className="rd476-hud" data-testid="rd476-hud" aria-label="Issue 476 R&D metrics">
      <p className="rd476-hud-title">
        R&D #476 <b>{issue476VariantLabel(knobs.variant)}</b>
      </p>
      <p>
        S {knobs.gradeThresholdS} / Easy floor {knobs.easyNormalTaskFloor} / mul{' '}
        {knobs.easyTaskCountMul}
      </p>
      {result ? (
        <ul>
          <li>rank {result.grade}</li>
          <li>delivered {result.delivered}</li>
          <li>complete {completionRatePct(result.done, taskCount)}</li>
          <li>senior HP {seniorHp ?? formatSprintResultSeniorHp(result)}</li>
          <li>review-wait max {result.reviewQueueMax}</li>
        </ul>
      ) : (
        <p>Sprint 1–3 のリザルトで rank / delivered / complete を出す</p>
      )}
    </aside>
  );
}
