import type { ReactNode } from 'react';
import styles from './SprintLayout.module.css';

const SPRINT_LAYOUT_SLOTS = ['header', 'status', 'stage', 'deck', 'controls'] as const;

type SprintLayoutSlot = (typeof SPRINT_LAYOUT_SLOTS)[number];

const SLOT_CLASS_NAMES: Record<SprintLayoutSlot, string> = {
  header: styles.headerSlot,
  status: styles.statusSlot,
  stage: styles.stageSlot,
  deck: styles.deckSlot,
  controls: styles.controlsSlot,
};

export interface SprintLayoutProps {
  header: ReactNode;
  status: ReactNode;
  stage: ReactNode;
  deck: ReactNode;
  controls: ReactNode;
  overlays?: ReactNode;
}

function SprintLayoutSlotView({ name, children }: { name: SprintLayoutSlot; children: ReactNode }) {
  return (
    <div
      className={`sprint-layout-slot sprint-layout-slot-${name} ${styles.slot} ${SLOT_CLASS_NAMES[name]}`}
      data-sprint-slot={name}
      data-testid={`sprint-slot-${name}`}
    >
      {children}
    </div>
  );
}

export function SprintLayout({
  header,
  status,
  stage,
  deck,
  controls,
  overlays,
}: SprintLayoutProps) {
  const slots = { header, status, stage, deck, controls } satisfies Record<
    SprintLayoutSlot,
    ReactNode
  >;

  return (
    <div className={`sprint-layout ${styles.root}`} data-testid="sprint-layout">
      {SPRINT_LAYOUT_SLOTS.map((name) => (
        <SprintLayoutSlotView key={name} name={name}>
          {slots[name]}
        </SprintLayoutSlotView>
      ))}
      {overlays}
    </div>
  );
}
