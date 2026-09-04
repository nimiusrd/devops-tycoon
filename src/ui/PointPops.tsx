/**
 * 数字ポップ演出（SPEC 第18.2）。
 *
 * 出荷ポイント（`deliveryScore`）が増えるたびに `+N` をポップさせる。
 * シミュレーション状態を読むだけの純表示で、増分の検出に前回値の ref を使う。
 * 高価値で大きく弾けるが、決定論には影響しない（描画専用。第22.2）。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { useAudio } from '../audio/useAudio';

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
  /** 選択中チーム。切替時は増分検出をリセットし誤ポップを防ぐ。 */
  teamId?: string;
}

export function PointPops({ deliveryScore, teamId }: PointPopsProps) {
  const prev = useRef(deliveryScore);
  const prevTeamId = useRef(teamId);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());
  const [pops, setPops] = useState<Pop[]>([]);
  const { playSfx } = useAudio();

  // 得点・チームの更新では消去予約を取り消さず、各ポップ自身の寿命を守る。
  useEffect(() => {
    const pendingTimers = timers.current;
    return () => {
      for (const timer of pendingTimers) window.clearTimeout(timer);
      pendingTimers.clear();
    };
  }, []);

  useEffect(() => {
    if (prevTeamId.current !== teamId) {
      prevTeamId.current = teamId;
      prev.current = deliveryScore;
      return;
    }
    const delta = deliveryScore - prev.current;
    prev.current = deliveryScore;
    if (delta <= 0) return;
    playSfx('ship');
    const pop: Pop = { id: nextId.current++, amount: delta, x: 20 + Math.random() * 60 };
    setPops((cur) => [...cur, pop].slice(-MAX_POPS));
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setPops((cur) => cur.filter((p) => p.id !== pop.id));
    }, 1100);
    timers.current.add(timer);
  }, [deliveryScore, teamId, playSfx]);

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
