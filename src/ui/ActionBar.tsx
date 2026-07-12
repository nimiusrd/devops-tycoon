/**
 * 介入アクションバー（SPEC 第4.3 / 第6.1 / mockups/main-screen 準拠）。
 *
 * マネジメント集中力（⚡）と、各介入アクション（コスト・CD・Ready）を並べる。
 * assignTask / splitPr は武装トグル（盤面ドラッグで確定。RI-30）。
 * 他アクションはクリックで即 `dispatch`。RI-51: 対象数バッジ・発動不能理由。
 */
import { useCallback, useMemo, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ACTION_DEFS } from '../data/actions';
import {
  deriveActionAvailability,
  deriveModifierRing,
  formatInterventionFailure,
  planActionBarView,
  type ActionBlockReason,
} from '../render/actionBarView';
import { isDraggableAction, type DraggableActionId } from '../render/boardDragPlan';
import { formatActionDefTags, formatActionTooltip } from '../render/eventOutcomeView';
import type { ActionId, ActionTarget, InterventionOutcome, SprintState } from '../sim/types';
import { EffectTagList } from './EffectTagList';

const FEEDBACK_TTL_MS = 1000;

interface FocusPop {
  id: number;
  text: string;
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

function FocusFeedbackPops({ pops }: { pops: FocusPop[] }) {
  return (
    <div className="focus-feedback-pops" aria-hidden="true">
      <AnimatePresence>
        {pops.map((pop) => (
          <motion.span
            key={pop.id}
            className={`focus-feedback-pop focus-feedback-${pop.tone}`}
            initial={{ y: 6, opacity: 0, scale: 0.85 }}
            animate={{ y: -18, opacity: 1, scale: 1 }}
            exit={{ y: -32, opacity: 0, scale: 0.9 }}
            transition={{ duration: 0.55, ease: 'easeOut' }}
          >
            {pop.text}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}

export interface ActionBarProps {
  sprint: SprintState;
  sprintTick: number;
  disabled: boolean;
  armedId: DraggableActionId | null;
  onArm: (id: DraggableActionId | null) => void;
  onAction: (id: ActionId, target?: ActionTarget) => InterventionOutcome;
}

export function ActionBar({
  sprint,
  sprintTick,
  disabled,
  armedId,
  onArm,
  onAction,
}: ActionBarProps) {
  const { focus, config, cooldowns, comboGauge } = sprint;
  const availabilityById = useMemo(() => {
    const map = new Map<ActionId, ReturnType<typeof deriveActionAvailability>>();
    for (const item of planActionBarView(sprint, disabled)) {
      map.set(item.actionId, item);
    }
    return map;
  }, [sprint, disabled]);

  const [shakingId, setShakingId] = useState<ActionId | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gaugeFlash, setGaugeFlash] = useState(false);
  const [focusPops, setFocusPops] = useState<FocusPop[]>([]);
  const nextPopId = useRef(0);

  const pushFocusPop = useCallback((text: string, tone: FocusPop['tone']) => {
    const pop: FocusPop = { id: nextPopId.current++, text, tone };
    setFocusPops((cur) => [...cur, pop]);
    window.setTimeout(() => {
      setFocusPops((cur) => cur.filter((p) => p.id !== pop.id));
    }, FEEDBACK_TTL_MS);
  }, []);

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
        pushFocusPop(`-⚡${focusCost}`, 'cost');
        if (focusRefund && focusRefund > 0) {
          pushFocusPop(`+⚡${focusRefund}`, 'refund');
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

  const handleAction = useCallback(
    (id: ActionId) => {
      if (isDraggableAction(id)) {
        const availability = availabilityById.get(id);
        if (!availability?.canActivate && armedId !== id) return;
        onArm(armedId === id ? null : id);
        return;
      }
      if (armedId) onArm(null);
      const outcome = onAction(id);
      applyOutcomeFeedback(id, outcome);
    },
    [armedId, availabilityById, applyOutcomeFeedback, onAction, onArm],
  );

  return (
    <footer className="actionbar" data-testid="action-bar">
      <div className="focus">
        <div className="focus-icon" aria-hidden="true">
          🧑‍💼
        </div>
        <div className="focus-body">
          <div className="focus-label">マネジメント集中力</div>
          <div className="focus-energy" data-testid="focus">
            ⚡{focus}
            <small>/{config.focusMax}</small>
            <FocusFeedbackPops pops={focusPops} />
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
        </div>
      </div>
      <div className="actions">
        {ACTION_DEFS.map((a) => {
          const availability = availabilityById.get(a.id)!;
          const remaining = cooldowns[a.id] ?? 0;
          const onCooldown = remaining > 0;
          const armed = armedId === a.id;
          const ready = availability.canActivate || armed;
          const cdPct = onCooldown ? Math.round((1 - remaining / a.cooldownTicks) * 100) : 100;
          const modRing = sprint.complete
            ? { active: false, remaining: 0, total: 0 }
            : deriveModifierRing(sprint, sprintTick, a.id);
          const modPct = modRing.active ? Math.round((modRing.remaining / modRing.total) * 100) : 0;
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
              ? '（盤面で対象へドラッグ）'
              : '（クリックで武装）'
            : '';
          return (
            <button
              type="button"
              key={a.id}
              className={`action${tone}${ready ? ' ready' : ''}${armed ? ' armed' : ''}${blockClass}${shakingId === a.id ? ' shake' : ''}`}
              data-testid={`action-${a.id}`}
              data-block-reason={availability.blockReason ?? ''}
              data-armed={armed ? 'true' : undefined}
              disabled={!ready && !armed}
              onClick={() => handleAction(a.id)}
              title={`${formatActionTooltip(a)}${dragHint}`}
            >
              {availability.targetBadge && (
                <span className="action-target-badge" data-testid={`action-badge-${a.id}`}>
                  {availability.targetBadge}
                </span>
              )}
              <span className="ico">{a.icon}</span>
              <span className="name">{a.label}</span>
              {!ready && !armed && availability.blockMessage && (
                <span className="action-block-reason" data-testid={`action-reason-${a.id}`}>
                  {availability.blockMessage}
                </span>
              )}
              {armed && (
                <span className="action-block-reason" data-testid={`action-armed-${a.id}`}>
                  武装中
                </span>
              )}
              <EffectTagList tags={formatActionDefTags(a)} testId={`action-tags-${a.id}`} />
              <span className="cost">⚡{a.cost}</span>
              <span className={`cd${onCooldown ? '' : ' full'}`}>
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
          );
        })}
      </div>
      <AnimatePresence>
        {toast && (
          <motion.div
            className="action-toast"
            data-testid="action-toast"
            role="status"
            initial={{ y: 12, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ duration: 0.25 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </footer>
  );
}
