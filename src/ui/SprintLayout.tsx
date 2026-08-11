import type { ReactNode } from 'react';

const SPRINT_LAYOUT_SLOTS = ['header', 'status', 'stage', 'deck', 'controls'] as const;

type SprintLayoutSlot = (typeof SPRINT_LAYOUT_SLOTS)[number];

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
      className={`sprint-layout-slot sprint-layout-slot-${name}`}
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
    <div className="sprint-layout" data-testid="sprint-layout">
      {SPRINT_LAYOUT_SLOTS.map((name) => (
        <SprintLayoutSlotView key={name} name={name}>
          {slots[name]}
        </SprintLayoutSlotView>
      ))}
      {overlays}
    </div>
  );
}
