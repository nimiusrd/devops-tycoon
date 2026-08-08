/**
 * コンボ表示（SPEC 第6.2 / 第18.2 の `COMBO xN`）。
 *
 * 連続 Done でコンボが伸び、出荷倍率が上がる。倍率に応じて演出が派手になる。
 * Framer Motion で弾むマイクロインタラクションを付ける（状態は読むだけ。第22.2）。
 */
import { AnimatePresence, motion } from 'framer-motion';
import { deliveryComboMultiplier } from '../sim/model';

export interface ComboBadgeProps {
  combo: number;
  /** 安定中は、実出荷と同じコンボ上限を倍率表示へ反映する。 */
  stabilized?: boolean;
}

/** これ未満のコンボは表示しない（チラつき防止）。 */
const SHOW_FROM = 2;

export function ComboBadge({ combo, stabilized = false }: ComboBadgeProps) {
  const visible = combo >= SHOW_FROM;
  const mult = deliveryComboMultiplier(combo, stabilized);
  return (
    <div className="combo-badge" data-testid="combo" data-combo={combo}>
      <AnimatePresence>
        {visible && (
          <motion.div
            key="combo"
            className="combo-inner"
            initial={{ scale: 0.6, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.6, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 320, damping: 18 }}
          >
            <motion.div
              className="combo-x"
              key={combo}
              initial={{ scale: 1.3 }}
              animate={{ scale: 1 }}
              transition={{ type: 'spring', stiffness: 400, damping: 12 }}
            >
              COMBO ×{combo}
            </motion.div>
            <div className="combo-mult">出荷倍率 {mult.toFixed(1)}x</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
