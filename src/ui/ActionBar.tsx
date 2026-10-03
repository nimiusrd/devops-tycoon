/**
 * 介入アクションバー（SPEC 第4.3 / 第6.1 準拠）。
 *
 * マネジメント集中力（⚡）と、各介入アクション（コスト・CD・Ready）を並べる。
 * assignTask / splitPr は武装トグル（盤面ドラッグまたは HTML 対象選択で確定。RI-30 / RI-146）。
 * 他アクションはクリックで即 `dispatch`。RI-51: 対象数バッジ・発動不能理由。
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { ACTION_DEFS } from '../data/actions';
import {
  deriveActionAvailability,
  deriveModifierRing,
  formatInterventionFailure,
  planActionBarView,
  planActionPresentations,
  type ActionBlockReason,
} from '../render/actionBarView';
import { planActionTargetPickerView } from '../render/actionTargetPickerView';
import { isDraggableAction, planBoardDrag, type DraggableActionId } from '../render/boardDragPlan';
import { formatActionTooltip } from '../render/eventOutcomeView';
import type {
  ActionId,
  ActionTarget,
  InterventionOutcome,
  OrgState,
  SprintState,
} from '../sim/types';
import { ManagerPortrait } from './ManagerPortrait';
import { useResponsiveMode } from './responsiveMode';
import { TermTip } from './TermTip';
import { VisualIcon, VisualIconText } from './VisualIcon';

const FEEDBACK_TTL_MS = 1000;

/** 編成ダイアログや全社マップなど、前面 UI が Escape を使う状態か。 */
function escapeOwnedByFrontOverlay(): boolean {
  if (typeof document === 'undefined') return false;
  return document.querySelector('[role="dialog"], [data-testid="zoom-overlay"]') !== null;
}

interface FocusPop {
  id: number;
  sign: '-' | '+';
  amount: number;
  tone: 'cost' | 'refund';
}

/** 連携ゲージのラベル表示。 */
function FocusPips({ focus, max }: { focus: number; max: number }) {
  const pips = Array.from({ length: max }, (_, i) => i < focus);
  return (
    <div className="pips">
      {pips.map((on, i) => (
        <i key={i} className={on ? 'on' : ''} />
      ))}
    </div>
  );
}

function FocusFeedbackPops({ pops, reducedMotion }: { pops: FocusPop[]; reducedMotion: boolean }) {
  return (
    <div className="focus-feedback-pops" aria-hidden="true">
      <AnimatePresence>
        {pops.map((pop) => (
          <motion.span
            key={pop.id}
            className={`focus-feedback-pop focus-feedback-${pop.tone}`}
            initial={reducedMotion ? false : { y: 6, opacity: 0, scale: 0.85 }}
            animate={reducedMotion ? { opacity: 1 } : { y: -18, opacity: 1, scale: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { y: -32, opacity: 0, scale: 0.9 }}
            transition={{ duration: reducedMotion ? 0 : 0.55, ease: 'easeOut' }}
          >
            {pop.sign}
            <VisualIcon name="focus" size="hud" />
            {pop.amount}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export interface ActionBarProps {
  sprint: SprintState;
  /** 対象可否判定（AI無効など）に使う。省略時は空オブジェクト相当。 */
  org?: OrgState;
  sprintTick: number;
  disabled: boolean;
  /** プレイヤー Pause 中。介入の状態は見せたまま発動だけ止める。 */
  paused: boolean;
  armedId: DraggableActionId | null;
  onArm: (id: DraggableActionId | null) => void;
  onAction: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
  /** 説明確認中の作用先を盤面へ対応付ける。発動や武装は行わない。 */
  onActionInspect?: (id: ActionId | null) => void;
  /** タスク差配の担当（武装中に選択。省略＝理想担当）。 */
  assignAssignee?: 'ai' | 'senior';
  onAssignAssigneeChange?: (assignee: 'ai' | 'senior' | undefined) => void;
  /** ドラッグ発動など ActionBar 外からの結果フィードバック。 */
  outcomeFeedback?: { id: ActionId; outcome: InterventionOutcome; nonce: number } | null;
}

export function ActionBar({
  sprint,
  org,
  sprintTick,
  disabled,
  paused,
  armedId,
  onArm,
  onAction,
  onActionInspect,
  assignAssignee,
  onAssignAssigneeChange,
  outcomeFeedback,
}: ActionBarProps) {
  const { focus, config, cooldowns, comboGauge } = sprint;
  const responsiveMode = useResponsiveMode();
  const reducedMotion = useReducedMotion() ?? false;
  const presentations = useMemo(() => planActionPresentations(sprint), [sprint]);
  const presentationById = useMemo(
    () => new Map(presentations.map((item) => [item.actionId, item])),
    [presentations],
  );
  const [inspectId, setInspectId] = useState<ActionId>(ACTION_DEFS[0].id);
  const [inspectOpen, setInspectOpen] = useState(false);
  const inspectPresentation = presentationById.get(inspectId)!;
  const inspectDefinition = ACTION_DEFS.find((item) => item.id === inspectId)!;
  const inspectRemaining = cooldowns[inspectId] ?? 0;
  const stabilityRing = sprint.complete
    ? { active: false, remaining: 0, total: 0 }
    : deriveModifierRing(sprint, sprintTick, 'stability');
  const stabilityPct = stabilityRing.active
    ? Math.round((stabilityRing.remaining / stabilityRing.total) * 100)
    : 0;
  const availabilityById = useMemo(() => {
    const map = new Map<ActionId, ReturnType<typeof deriveActionAvailability>>();
    const disabledReason = disabled ? 'complete' : paused ? 'paused' : undefined;
    for (const item of planActionBarView(sprint, disabledReason, org, sprintTick)) {
      map.set(item.actionId, item);
    }
    return map;
  }, [sprint, disabled, paused, org, sprintTick]);

  const targetPicker = useMemo(() => {
    if (!armedId) return null;
    return planActionTargetPickerView(sprint, org ?? ({} as OrgState), armedId, {
      assignee: assignAssignee,
      tick: sprintTick,
      paused,
    });
  }, [armedId, assignAssignee, org, paused, sprint, sprintTick]);

  const [shakingId, setShakingId] = useState<ActionId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gaugeFlash, setGaugeFlash] = useState(false);
  const [focusPops, setFocusPops] = useState<FocusPop[]>([]);
  const nextPopId = useRef(0);
  const lastFeedbackNonce = useRef<number | null>(null);
  const actionButtonRefs = useRef<Partial<Record<ActionId, HTMLButtonElement | null>>>({});
  const hoveredActionRef = useRef<ActionId | null>(null);
  const focusedActionRef = useRef<ActionId | null>(null);
  const inspectionSourceRef = useRef<'pointer' | 'focus'>('focus');
  const updateInspection = useCallback(() => {
    const primary =
      inspectionSourceRef.current === 'pointer'
        ? hoveredActionRef.current
        : focusedActionRef.current;
    const secondary =
      inspectionSourceRef.current === 'pointer'
        ? focusedActionRef.current
        : hoveredActionRef.current;
    onActionInspect?.(primary ?? secondary ?? (inspectOpen ? inspectId : null));
  }, [inspectId, inspectOpen, onActionInspect]);
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const focusedArmRef = useRef<DraggableActionId | null>(null);
  const focusedOptionIdRef = useRef<number | null>(null);

  const pushFocusPop = useCallback(
    (sign: FocusPop['sign'], amount: number, tone: FocusPop['tone']) => {
      const pop: FocusPop = { id: nextPopId.current++, sign, amount, tone };
      setFocusPops((cur) => [...cur, pop]);
      window.setTimeout(() => {
        setFocusPops((cur) => cur.filter((p) => p.id !== pop.id));
      }, FEEDBACK_TTL_MS);
    },
    [],
  );

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(null), FEEDBACK_TTL_MS);
  }, []);

  const triggerShake = useCallback((id: ActionId) => {
    setShakingId(id);
    window.setTimeout(() => setShakingId(null), 400);
  }, []);

  const applyOutcomeFeedback = useCallback(
    (id: ActionId, outcome: InterventionOutcome) => {
      if (outcome.ok && outcome.effect) {
        const { focusCost, focusRefund, gaugeGain } = outcome.effect;
        pushFocusPop('-', focusCost, 'cost');
        if (focusRefund && focusRefund > 0) {
          pushFocusPop('+', focusRefund, 'refund');
        }
        if (gaugeGain > 0) {
          setGaugeFlash(true);
          window.setTimeout(() => setGaugeFlash(false), 500);
        }
        return;
      }
      if (!outcome.ok && outcome.reason) {
        triggerShake(id);
        showToast(formatInterventionFailure(outcome.reason as ActionBlockReason, id));
      }
    },
    [pushFocusPop, showToast, triggerShake],
  );

  // ドラッグ経路など ActionBar 外からの発動結果を同じ UI フィードバックへ載せる。
  useEffect(() => {
    if (!outcomeFeedback) return;
    if (lastFeedbackNonce.current === outcomeFeedback.nonce) return;
    lastFeedbackNonce.current = outcomeFeedback.nonce;
    applyOutcomeFeedback(outcomeFeedback.id, outcomeFeedback.outcome);
  }, [outcomeFeedback, applyOutcomeFeedback]);

  const disarm = useCallback(() => {
    const previous = armedId;
    onArm(null);
    if (previous) {
      // 取消後は武装したアクションへフォーカスを戻す（DS-08）。
      queueMicrotask(() => actionButtonRefs.current[previous]?.focus());
    }
  }, [armedId, onArm]);

  const confirmTarget = useCallback(
    (target: ActionTarget) => {
      if (!armedId || paused) return;
      const outcome = onAction(armedId, target);
      applyOutcomeFeedback(armedId, outcome);
      if (!outcome.ok) return;
      queueMicrotask(() => actionButtonRefs.current[armedId]?.focus());
    },
    [armedId, applyOutcomeFeedback, onAction, paused],
  );

  // 武装開始時、またはフォーカス中の候補が消えたときだけフォーカスを移す。
  // tick 更新で一覧が作り直されても、残っている操作のフォーカスは奪わない。
  useEffect(() => {
    if (!armedId) {
      focusedArmRef.current = null;
      focusedOptionIdRef.current = null;
      return;
    }
    const active = typeof document !== 'undefined' ? document.activeElement : null;
    const focusFellOff =
      active == null ||
      (typeof document !== 'undefined' && active === document.body) ||
      (active instanceof HTMLElement && !active.isConnected);
    if (!targetPicker) {
      if (focusedArmRef.current === armedId && focusFellOff) {
        actionButtonRefs.current[armedId]?.focus();
      }
      focusedArmRef.current = null;
      focusedOptionIdRef.current = null;
      return;
    }
    const focusedOptionId = focusedOptionIdRef.current;
    const optionGone =
      focusedArmRef.current === armedId &&
      focusedOptionId != null &&
      !targetPicker.options.some((option) => option.taskId === focusedOptionId);
    if (focusedArmRef.current === armedId && !optionGone) return;
    // 候補削除でフォーカスが body に落ちたときだけ回収する。別ボタンへ移った後は奪わない。
    if (optionGone && !focusFellOff) {
      focusedOptionIdRef.current = null;
      return;
    }

    const frame = window.requestAnimationFrame(() => {
      const next = pickerRef.current?.querySelector<HTMLButtonElement>(
        'button[data-action-target-option]:not([disabled])',
      );
      if (next) {
        next.focus();
      } else {
        actionButtonRefs.current[armedId]?.focus();
        focusedOptionIdRef.current = null;
      }
      focusedArmRef.current = armedId;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [armedId, targetPicker]);

  // Escape で武装解除＋起点復帰。用語チップと前面オーバーレイの Escape は渡す。
  useEffect(() => {
    if (!armedId) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      const target = event.target;
      if (typeof Element !== 'undefined' && target instanceof Element) {
        const tip = target.closest('details.term-tip, details.action-inspect');
        if (
          typeof HTMLDetailsElement !== 'undefined' &&
          tip instanceof HTMLDetailsElement &&
          tip.open
        ) {
          return;
        }
      }
      if (escapeOwnedByFrontOverlay()) return;
      event.preventDefault();
      event.stopPropagation();
      disarm();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [armedId, disarm]);

  const handleAction = useCallback(
    (id: ActionId) => {
      if (isDraggableAction(id)) {
        const availability = availabilityById.get(id);
        if (!availability?.canActivate && armedId !== id) return;
        if (armedId === id) {
          disarm();
          return;
        }
        const plan = planBoardDrag(sprint, id, assignAssignee);
        if (!plan) {
          // 描画粒が無くても HTML 候補があれば武装して選ばせる。候補ゼロだけ自動対象。
          const picker = planActionTargetPickerView(sprint, org ?? ({} as OrgState), id, {
            assignee: assignAssignee,
            tick: sprintTick,
            paused,
          });
          if (picker) {
            onArm(id);
            return;
          }
          const outcome = onAction(id);
          applyOutcomeFeedback(id, outcome);
          return;
        }
        onArm(id);
        return;
      }
      if (armedId) onArm(null);
      const outcome = onAction(id);
      applyOutcomeFeedback(id, outcome);
    },
    [
      armedId,
      assignAssignee,
      availabilityById,
      applyOutcomeFeedback,
      disarm,
      onAction,
      onArm,
      org,
      paused,
      sprint,
      sprintTick,
    ],
  );

  return (
    <footer
      className="actionbar"
      data-testid="action-bar"
      data-paused={paused ? 'true' : 'false'}
      data-responsive-width={responsiveMode.width}
      data-responsive-height={responsiveMode.height}
    >
      <div className="focus">
        <div className="focus-icon">
          <ManagerPortrait />
        </div>
        <div className="focus-body">
          <div className="focus-label">
            <TermTip
              termId="focus"
              placement={responsiveMode.width === 'narrow' ? 'inline' : 'up'}
            />
          </div>
          <div className="focus-energy" data-testid="focus">
            <VisualIcon name="focus" size="header" />
            {focus}
            <small>/{config.focusMax}</small>
            <FocusFeedbackPops pops={focusPops} reducedMotion={reducedMotion} />
          </div>
          <FocusPips focus={focus} max={config.focusMax} />
          <div
            className={`combo-gauge${gaugeFlash ? ' flash' : ''}`}
            data-testid="combo-gauge"
            data-gauge={comboGauge}
            title="連携ゲージ"
          >
            <i style={{ width: `${Math.round(comboGauge * 100)}%` }} />
          </div>
          {stabilityRing.active && (
            <div
              className="stability-status"
              data-testid="stability-status"
              title={`運用安定: 残り ${stabilityRing.remaining} tick`}
            >
              <span className="stability-status-label">
                <VisualIcon name="stability" size="hud" />
                運用安定
              </span>
              <strong className="stability-status-value">
                残り {stabilityRing.remaining} tick
              </strong>
              <span className="stability-status-meter" aria-hidden="true">
                <i style={{ width: `${stabilityPct}%` }} />
              </span>
            </div>
          )}
        </div>
      </div>
      {armedId === 'assignTask' && onAssignAssigneeChange && (
        <div className="assign-assignee" data-testid="assign-assignee">
          <span className="assign-assignee-label">担当</span>
          <button
            type="button"
            className={`assign-assignee-btn${!assignAssignee ? ' on' : ''}`}
            data-testid="assign-assignee-ideal"
            disabled={paused}
            onClick={() => onAssignAssigneeChange(undefined)}
          >
            理想
          </button>
          <button
            type="button"
            className={`assign-assignee-btn${assignAssignee === 'ai' ? ' on' : ''}`}
            data-testid="assign-assignee-ai"
            disabled={paused}
            onClick={() => onAssignAssigneeChange('ai')}
          >
            AI
          </button>
          <button
            type="button"
            className={`assign-assignee-btn${assignAssignee === 'senior' ? ' on' : ''}`}
            data-testid="assign-assignee-senior"
            disabled={paused}
            onClick={() => onAssignAssigneeChange('senior')}
          >
            シニア
          </button>
        </div>
      )}
      {targetPicker && (
        <div
          className="action-target-picker"
          data-testid="action-target-picker"
          data-armed={targetPicker.armed}
          ref={pickerRef}
        >
          <div className="action-target-picker-header">
            <span className="action-target-picker-title" id="action-target-picker-title">
              {targetPicker.title}
            </span>
            <button
              type="button"
              className="action-target-cancel"
              data-testid="action-target-cancel"
              onClick={disarm}
            >
              取消
            </button>
          </div>
          <ul className="action-target-picker-list" aria-labelledby="action-target-picker-title">
            {targetPicker.options.map((option) => {
              const status = option.blockMessage ? `利用不可: ${option.blockMessage}。` : '';
              return (
                <li key={option.taskId}>
                  <button
                    type="button"
                    data-action-target-option=""
                    data-task-id={option.taskId}
                    data-testid={`action-target-option-${option.taskId}`}
                    className={`action-target-option${!option.canSelect || paused ? ' disabled' : ''}`}
                    disabled={!option.canSelect || paused}
                    title={option.blockMessage ?? option.detail}
                    aria-label={`${option.label}。${option.detail}。${status}選ぶと実行。`}
                    onFocus={() => {
                      focusedOptionIdRef.current = option.taskId;
                    }}
                    onClick={() => confirmTarget(option.target)}
                  >
                    <span className="action-target-option-label">{option.label}</span>
                    <span className="action-target-option-detail">{option.detail}</span>
                    {option.blockMessage && (
                      <span className="action-target-option-reason">{option.blockMessage}</span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <div className="action-panel">
        <div className="actions">
          {ACTION_DEFS.map((a) => {
            const presentation = presentationById.get(a.id)!;
            const availability = availabilityById.get(a.id)!;
            const remaining = cooldowns[a.id] ?? 0;
            const onCooldown = remaining > 0;
            const armed = !paused && armedId === a.id;
            const ready = availability.canActivate || armed;
            const cdPct = onCooldown ? Math.round((1 - remaining / a.cooldownTicks) * 100) : 100;
            const modRing = sprint.complete
              ? { active: false, remaining: 0, total: 0 }
              : deriveModifierRing(sprint, sprintTick, a.id);
            const modPct = modRing.active
              ? Math.round((modRing.remaining / modRing.total) * 100)
              : 0;
            const tone = a.tone ? ` ${a.tone}` : '';
            const blockClass =
              availability.blockReason === 'no-target'
                ? ' notarget'
                : availability.blockReason === 'no-focus'
                  ? ' nofocus'
                  : availability.blockReason === 'cooldown'
                    ? ' oncooldown'
                    : '';
            const dragHint = isDraggableAction(a.id)
              ? armed
                ? '（一覧か盤面ドラッグで対象を確定）'
                : '（クリックで武装）'
              : '';
            const tooltip = `${formatActionTooltip(a)}${dragHint}`;
            const statusLabel = armed
              ? '武装中。'
              : !ready && availability.blockMessage
                ? `利用不可: ${availability.blockMessage}。`
                : '実行可能。';
            const modLabel = modRing.active ? `効果残り ${modRing.remaining} tick。` : '';
            const cooldownLabel = onCooldown
              ? `CD 残り${remaining} tick`
              : `CD ${a.cooldownTicks} tick`;
            return (
              <div
                key={a.id}
                className="action-cell"
                onMouseEnter={() => {
                  hoveredActionRef.current = a.id;
                  inspectionSourceRef.current = 'pointer';
                  updateInspection();
                }}
                onMouseLeave={() => {
                  if (hoveredActionRef.current === a.id) hoveredActionRef.current = null;
                  updateInspection();
                }}
              >
                <button
                  type="button"
                  ref={(node) => {
                    actionButtonRefs.current[a.id] = node;
                  }}
                  className={`action${tone}${ready ? ' ready' : ''}${armed ? ' armed' : ''}${blockClass}${shakingId === a.id ? ' shake' : ''}`}
                  data-testid={`action-${a.id}`}
                  data-role={presentation.role}
                  data-block-reason={availability.blockReason ?? ''}
                  data-armed={armed ? 'true' : undefined}
                  disabled={!ready && !armed}
                  onClick={() => handleAction(a.id)}
                  onFocus={() => {
                    focusedActionRef.current = a.id;
                    inspectionSourceRef.current = 'focus';
                    updateInspection();
                  }}
                  onBlur={() => {
                    if (focusedActionRef.current === a.id) focusedActionRef.current = null;
                    updateInspection();
                  }}
                  title={tooltip}
                  aria-label={`${a.label}。集中力コスト ${a.cost}。対象 ${presentation.targetLabel}。主効果 ${presentation.effect}。代償 ${presentation.tradeoff}。${cooldownLabel}。${modLabel}${statusLabel}${tooltip}`}
                >
                  <span className="action-role">{presentation.roleLabel}</span>
                  <span className="action-heading">
                    <span className="ico">
                      <VisualIcon name={a.icon} size="hud" />
                    </span>
                    <span className="name">{a.label}</span>
                  </span>
                  <span className="action-target" data-testid={`action-target-${a.id}`}>
                    <span
                      className="action-target-badge"
                      data-testid={availability.targetBadge ? `action-badge-${a.id}` : undefined}
                    >
                      {presentation.targetLabel}
                    </span>
                  </span>
                  <span className="action-summary" data-testid={`action-summary-${a.id}`}>
                    {presentation.effect}
                  </span>
                  <span className="action-tradeoff" data-testid={`action-tradeoff-${a.id}`}>
                    {presentation.tradeoff}
                  </span>
                  <span className="action-resources">
                    <span className="cost">
                      <VisualIconText name="focus" size="hud">
                        {a.cost}
                      </VisualIconText>
                    </span>
                    <span className="action-cooldown" data-testid={`action-cooldown-${a.id}`}>
                      {cooldownLabel}
                    </span>
                    <span
                      className="action-gauge-gain"
                      data-testid={`action-gauge-${a.id}`}
                      title={`連携ゲージ +${Math.round(a.gauge * 100)}%`}
                    >
                      連携+{Math.round(a.gauge * 100)}%
                    </span>
                  </span>
                  <span className="action-state">
                    {!ready && !armed && availability.blockMessage ? (
                      <span className="action-block-reason" data-testid={`action-reason-${a.id}`}>
                        {availability.blockMessage}
                      </span>
                    ) : armed ? (
                      <span className="action-block-reason" data-testid={`action-armed-${a.id}`}>
                        武装中
                      </span>
                    ) : (
                      <span className="action-ready-label">実行可能</span>
                    )}
                  </span>
                  <span className={`cd${onCooldown ? '' : ' full'}`} aria-hidden="true">
                    <i style={{ width: `${cdPct}%` }} />
                  </span>
                  {modRing.active && (
                    <span
                      className="mod-ring"
                      data-testid={`action-mod-ring-${a.id}`}
                      title={`効果残り ${modRing.remaining} tick`}
                    >
                      <i style={{ width: `${modPct}%` }} />
                    </span>
                  )}
                </button>
              </div>
            );
          })}
        </div>
        <details
          className="action-inspect"
          data-testid="action-inspect"
          onToggle={(event) => {
            const open = event.currentTarget.open;
            setInspectOpen(open);
            onActionInspect?.(open ? inspectId : null);
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Escape' || !event.currentTarget.open) return;
            event.preventDefault();
            event.stopPropagation();
            event.currentTarget.open = false;
            setInspectOpen(false);
            onActionInspect?.(null);
            event.currentTarget.querySelector('summary')?.focus();
          }}
        >
          <summary data-testid="action-inspect-toggle">介入の詳しい説明</summary>
          <div className="action-inspect-panel" data-testid="action-inspect-detail">
            <label className="action-inspect-label" htmlFor="action-inspect-select">
              確認する介入
            </label>
            <select
              id="action-inspect-select"
              data-testid="action-inspect-select"
              value={inspectId}
              onChange={(event) => {
                const id = event.currentTarget.value as ActionId;
                setInspectId(id);
                onActionInspect?.(id);
              }}
              onFocus={() => onActionInspect?.(inspectId)}
            >
              {ACTION_DEFS.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.label}
                </option>
              ))}
            </select>
            <dl className="action-inspect-facts">
              <div>
                <dt>対象</dt>
                <dd>{inspectPresentation.targetLabel}</dd>
              </div>
              <div>
                <dt>主効果</dt>
                <dd>{inspectPresentation.effect}</dd>
              </div>
              <div>
                <dt>代償</dt>
                <dd>{inspectPresentation.tradeoff}</dd>
              </div>
              <div>
                <dt>集中力</dt>
                <dd>{inspectDefinition.cost}</dd>
              </div>
              <div>
                <dt>CD</dt>
                <dd>
                  {inspectDefinition.cooldownTicks} tick
                  {inspectRemaining > 0 && `（残り ${inspectRemaining} tick）`}
                </dd>
              </div>
              <div>
                <dt>状態</dt>
                <dd>
                  {!paused && armedId === inspectId
                    ? '武装中'
                    : (availabilityById.get(inspectId)?.blockMessage ?? '実行可能')}
                </dd>
              </div>
            </dl>
            <p>{inspectPresentation.description}</p>
            <p>注意: {inspectPresentation.sideEffect}</p>
            <p className="action-inspect-hint">ここで介入を選んでも発動しません。</p>
          </div>
        </details>
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="action-toast"
            data-testid="action-toast"
            role="status"
            initial={reducedMotion ? false : { y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={reducedMotion ? { opacity: 0 } : { y: 8, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 0.25 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
}
