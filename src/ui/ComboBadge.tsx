/**
 * コンボ表示（SPEC 第6.2 / 第18.2 の `COMBO xN`）。
 *
 * 連続 Done でコンボが伸び、出荷倍率が上がる。倍率に応じて演出が派手になる。
 * 渡す値は `liveComboCount` 済みの「今」の段数。完了スプリントや途切れ直後の 0 は出さない。
 * Framer Motion で弾むマイクロインタラクションを付ける（状態は読むだけ。第22.2）。
 */
import { motion, useReducedMotion } from 'framer-motion';
import { isComboHudVisible } from '../render/sprintComboView';
import { deliveryComboMultiplier } from '../sim/model';

export interface ComboBadgeProps {
  /** 現在のコンボ段数（終了済みスプリントでは 0）。 */
  combo: number;
  /** 安定中は、実出荷と同じコンボ上限を倍率表示へ反映する。 */
  stabilized?: boolean;
}

export function ComboBadge({ combo, stabilized = false }: ComboBadgeProps) {
  const visible = isComboHudVisible(combo);
  const reduceMotion = useReducedMotion();
  const mult = deliveryComboMultiplier(combo, stabilized);
  return (
    <div
      className="combo-badge"
      data-testid="combo"
      data-combo={combo}
      aria-label={visible ? `現在のコンボ ×${combo}` : '現在のコンボなし'}
    >
      {visible && (
        <motion.div
          key={combo}
          className="combo-inner"
          initial={reduceMotion ? false : { scale: 0.6, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={
            reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 320, damping: 18 }
          }
        >
          <div className="combo-x">COMBO ×{combo}</div>
          <div className="combo-mult">出荷倍率 {mult.toFixed(1)}x</div>
        </motion.div>
      )}
    </div>
  );
}
