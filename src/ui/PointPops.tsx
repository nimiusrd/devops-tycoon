/**
 * 数字ポップ演出（SPEC 第18.2）。
 *
 * 出荷ポイント（`deliveryScore`）が増えるたびに `+N` をポップさせる。
 * シミュレーション状態を読むだけの純表示で、増分の検出に前回値の ref を使う。
 * 高価値で大きく弾けるが、決定論には影響しない（描画専用。第22.2）。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

interface Pop {
  id: number;
  amount: number;
  /** 0..100 の横位置（散らすため）。 */
  x: number;
}

/** 同時に表示するポップの最大数（描き過ぎ防止）。 */
const MAX_POPS = 6;

export interface PointPopsProps {
  deliveryScore: number;
}

export function PointPops({ deliveryScore }: PointPopsProps) {
  const prev = useRef(deliveryScore);
  const nextId = useRef(0);
  const [pops, setPops] = useState<Pop[]>([]);

  useEffect(() => {
    const delta = deliveryScore - prev.current;
    prev.current = deliveryScore;
    if (delta <= 0) return;
    const pop: Pop = { id: nextId.current++, amount: delta, x: 20 + Math.random() * 60 };
    setPops((cur) => [...cur, pop].slice(-MAX_POPS));
    const timer = window.setTimeout(() => {
      setPops((cur) => cur.filter((p) => p.id !== pop.id));
    }, 1100);
    return () => window.clearTimeout(timer);
  }, [deliveryScore]);

  return (
    <div className="point-pops" aria-hidden="true">
      <AnimatePresence>
        {pops.map((p) => (
          <motion.span
            key={p.id}
            className={`point-pop${p.amount >= 12 ? ' big' : ''}`}
            style={{ left: `${p.x}%` }}
            initial={{ y: 0, opacity: 0, scale: 0.8 }}
            animate={{ y: -42, opacity: 1, scale: 1 }}
            exit={{ y: -70, opacity: 0 }}
            transition={{ duration: 1, ease: 'easeOut' }}
          >
            +{p.amount}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
