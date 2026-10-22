/**
 * 数字ポップ演出（SPEC 第18.2）。
 *
 * 出荷ポイント（`deliveryScore`）が増えるたびに `+N` をポップさせる。
 * シミュレーション状態を読むだけの純表示で、増分の検出に前回値の ref を使う。
 * 高価値で大きく弾けるが、決定論には影響しない（描画専用。第22.2）。
 */
import { useEffect, useRef, useState } from 'react';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { useAudio } from '../audio/useAudio';
import { MAX_POINT_POPS, reducedPointPopCapacity } from '../render/pointPopLayout';
import { VISUAL_TOKENS } from '../render/visualTokens';

interface Pop {
  id: number;
  amount: number;
  /** 0..100 の横位置（散らすため）。 */
  x: number;
  /** 動きを減らす設定で使う固定段。先行ポップが消えても位置を詰めない。 */
  row: number;
}

const POP_LAYOUT = VISUAL_TOKENS.dimensions.pointPops;

export interface PointPopsProps {
  deliveryScore: number;
  /** 選択中チーム。切替時は増分検出をリセットし誤ポップを防ぐ。 */
  teamId?: string;
}

export function PointPops({ deliveryScore, teamId }: PointPopsProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const layerRef = useRef<HTMLDivElement>(null);
  const capacity = useRef(MAX_POINT_POPS);
  const prev = useRef(deliveryScore);
  const prevTeamId = useRef(teamId);
  const nextId = useRef(0);
  const timers = useRef(new Set<number>());
  const [pops, setPops] = useState<Pop[]>([]);
  const { playSfx } = useAudio();

  useEffect(() => {
    const layer = layerRef.current;
    if (!layer) return;
    const summary = layer.parentElement?.querySelector('[data-testid="board-flow-summary"]');
    const measure = () => {
      const bounds = layer.getBoundingClientRect();
      // 工程要約の背景や下の影に得点を重ねない（余白はこの演出だけの局所値）。
      const topInset = summary
        ? Math.max(0, summary.getBoundingClientRect().bottom - bounds.top + 4)
        : 0;
      const next = reducedMotion
        ? reducedPointPopCapacity(bounds.height, topInset)
        : MAX_POINT_POPS;
      if (next === capacity.current) return;
      capacity.current = next;
      // リサイズで段数が減ったときも新しい得点を残す。
      setPops((cur) => (next === 0 ? [] : cur.slice(-next).map((pop, row) => ({ ...pop, row }))));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(layer);
    if (summary) observer.observe(summary);
    return () => observer.disconnect();
  }, [reducedMotion]);

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
    const pop = { id: nextId.current++, amount: delta, x: 20 + Math.random() * 60 };
    setPops((cur) => {
      const limit = capacity.current;
      if (limit === 0) return [];
      const retained = limit === 1 ? [] : cur.slice(-(limit - 1));
      const occupied = new Set(retained.map((item) => item.row));
      let row = 0;
      while (occupied.has(row)) row += 1;
      return [...retained, { ...pop, row }];
    });
    const timer = window.setTimeout(() => {
      timers.current.delete(timer);
      setPops((cur) => cur.filter((p) => p.id !== pop.id));
    }, 1100);
    timers.current.add(timer);
  }, [deliveryScore, teamId, playSfx]);

  return (
    <div
      ref={layerRef}
      className="point-pops"
      data-reduced-motion={reducedMotion}
      aria-hidden="true"
    >
      <AnimatePresence>
        {pops.map((p) => (
          <motion.span
            key={p.id}
            data-pop-id={p.id}
            className={`point-pop${p.amount >= 12 ? ' big' : ''}`}
            style={{ left: `${p.x}%` }}
            initial={reducedMotion ? false : { y: 0, opacity: 0, scale: 0.8 }}
            animate={
              reducedMotion
                ? { y: 0 - p.row * POP_LAYOUT.rowGap, opacity: 1, scale: 1 }
                : { y: -POP_LAYOUT.baseOffset, opacity: 1, scale: 1 }
            }
            exit={reducedMotion ? { opacity: 0 } : { y: -70, opacity: 0 }}
            transition={{ duration: reducedMotion ? 0 : 1, ease: 'easeOut' }}
          >
            +{p.amount}
          </motion.span>
        ))}
      </AnimatePresence>
    </div>
  );
}
