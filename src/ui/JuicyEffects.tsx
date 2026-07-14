import { motion } from 'framer-motion';

export type RewardCeremonyKind = 'relic' | 'evolution' | 'grade-s' | 'title';

export function SlowMotionOverlay({ clearedIncidentCount }: { clearedIncidentCount: number }) {
  return (
    <motion.div
      className="juicy-slowmo-overlay"
      data-testid="boss-slowmo"
      initial={{ opacity: 0 }}
      animate={{ opacity: [0, 0.9, 0.45, 0] }}
      transition={{ duration: 1.15, times: [0, 0.18, 0.62, 1], ease: 'easeOut' }}
    >
      <span className="juicy-slowmo-label">BOSS BREAK</span>
      <strong>最後の障害を突破</strong>
      <small>{clearedIncidentCount}件を鎮火</small>
    </motion.div>
  );
}

export function RewardCeremony({
  kind,
  title,
  detail,
}: {
  kind: RewardCeremonyKind;
  title: string;
  detail?: string;
}) {
  return (
    <motion.div
      className={`reward-ceremony reward-ceremony-${kind}`}
      data-testid={`reward-ceremony-${kind}`}
      initial={{ opacity: 0, scale: 0.78, y: 12 }}
      animate={{ opacity: 1, scale: 1, y: 0 }}
      transition={{ type: 'spring', stiffness: 340, damping: 20 }}
    >
      <span className="reward-ceremony-sparkles" aria-hidden="true">
        ✦ · ✧ · ✦
      </span>
      <strong>{title}</strong>
      {detail && <small>{detail}</small>}
    </motion.div>
  );
}
