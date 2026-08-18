/**
 * 四半期 OKR の表示用導出（RI-129）。
 *
 * `bossId` と `QuarterGoal` からテンプレートを選び、既存 KPI を Objective 配下の
 * Key Results へ束ねる。勝敗判定・目標生成・保存は知らない純関数（第22.2）。
 */
import {
  getOkrTemplateByBossId,
  isOkrKpiId,
  OKR_FOCUS_OBJECTIVE_ID,
  OKR_GUARDRAIL,
  OKR_KPI_IDS,
  OKR_KPI_SHORT_LABELS,
  type OkrKpiId,
  type OkrTemplateId,
} from '../data/okrTemplates';
import type { GoalKpiProgress, QuarterGoal } from '../sim/run/types';

export interface OkrKeyResultView {
  id: string;
  label: string;
  target?: number;
  actual?: number;
  status?: GoalKpiProgress['status'];
}

export interface OkrObjectiveView {
  id: string;
  title: string;
  description: string;
  keyResults: OkrKeyResultView[];
}

export interface OkrView {
  templateId: OkrTemplateId;
  objectives: OkrObjectiveView[];
}

export interface OkrViewInput {
  bossId: string;
  goal: QuarterGoal;
  /** レビュー用。渡す場合は status / target / actual / label を書き換えない。 */
  progress?: readonly GoalKpiProgress[];
}

function activeKpiIds(goal: QuarterGoal): OkrKpiId[] {
  return OKR_KPI_IDS.filter((id) => id !== 'aiAdoption' || goal.aiAdoptionTarget !== undefined);
}

function progressById(
  progress: readonly GoalKpiProgress[] | undefined,
): Map<string, GoalKpiProgress> {
  const map = new Map<string, GoalKpiProgress>();
  for (const kpi of progress ?? []) {
    map.set(kpi.id, kpi);
  }
  return map;
}

function toKeyResult(id: string, measured: Map<string, GoalKpiProgress>): OkrKeyResultView {
  const kpi = measured.get(id);
  if (kpi) {
    return {
      id: kpi.id,
      label: kpi.label,
      target: kpi.target,
      actual: kpi.actual,
      status: kpi.status,
    };
  }
  return {
    id,
    label: isOkrKpiId(id) ? OKR_KPI_SHORT_LABELS[id] : id,
  };
}

/**
 * ボスと四半期目標から OKR 表示を作る。
 * 評価値は `progress` をそのまま載せ、無い KPI はラベルだけの KR にする。
 */
export function planOkrView(input: OkrViewInput): OkrView {
  const template = getOkrTemplateByBossId(input.bossId);
  const active = new Set(activeKpiIds(input.goal));
  const measured = progressById(input.progress);
  const used = new Set<string>();

  const focusResults: OkrKeyResultView[] = [];
  for (const id of template.focus.keyResultIds) {
    if (!active.has(id)) continue;
    focusResults.push(toKeyResult(id, measured));
    used.add(id);
  }

  const guardrailResults: OkrKeyResultView[] = [];
  for (const id of OKR_KPI_IDS) {
    if (!active.has(id) || used.has(id)) continue;
    guardrailResults.push(toKeyResult(id, measured));
    used.add(id);
  }
  for (const kpi of input.progress ?? []) {
    if (used.has(kpi.id)) continue;
    guardrailResults.push(toKeyResult(kpi.id, measured));
    used.add(kpi.id);
  }

  const objectives: OkrObjectiveView[] = [];
  if (focusResults.length > 0) {
    objectives.push({
      id: OKR_FOCUS_OBJECTIVE_ID,
      title: template.focus.title,
      description: template.focus.description,
      keyResults: focusResults,
    });
  }
  if (guardrailResults.length > 0) {
    objectives.push({
      id: OKR_GUARDRAIL.id,
      title: OKR_GUARDRAIL.title,
      description: OKR_GUARDRAIL.description,
      keyResults: guardrailResults,
    });
  }

  return { templateId: template.id, objectives };
}
