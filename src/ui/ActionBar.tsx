/**
 * 介入アクションバー（SPEC 第4.3 / 第6.1 / mockups/main-screen 準拠）。
 *
 * マネジメント集中力（⚡）と、各介入アクション（コスト・CD・Ready）を並べる。
 * クリックで `dispatch` し、状態は上位から読むだけ（第22.2）。
 */
import { ACTION_DEFS } from '../data/actions';
import type { ActionId, SprintState } from '../sim/types';

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

export interface ActionBarProps {
  sprint: SprintState;
  disabled: boolean;
  onAction: (id: ActionId) => void;
}

export function ActionBar({ sprint, disabled, onAction }: ActionBarProps) {
  const { focus, config, cooldowns, comboGauge } = sprint;
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
          </div>
          <FocusPips focus={focus} max={config.focusMax} />
          <div className="combo-gauge" title="連携ゲージ">
            <i style={{ width: `${Math.round(comboGauge * 100)}%` }} />
          </div>
        </div>
      </div>
      <div className="actions">
        {ACTION_DEFS.map((a) => {
          const remaining = cooldowns[a.id] ?? 0;
          const onCooldown = remaining > 0;
          const noFocus = focus < a.cost;
          const ready = !onCooldown && !noFocus && !disabled;
          const cdPct = onCooldown ? Math.round((1 - remaining / a.cooldownTicks) * 100) : 100;
          const tone = a.tone ? ` ${a.tone}` : '';
          return (
            <button
              type="button"
              key={a.id}
              className={`action${tone}${ready ? ' ready' : ''}${noFocus ? ' nofocus' : ''}`}
              data-testid={`action-${a.id}`}
              disabled={!ready}
              onClick={() => onAction(a.id)}
              title={`${a.description}（副作用: ${a.sideEffect}）`}
            >
              <span className="ico">{a.icon}</span>
              <span className="name">{a.label}</span>
              <span className="cost">⚡{a.cost}</span>
              <span className={`cd${onCooldown ? '' : ' full'}`}>
                <i style={{ width: `${cdPct}%` }} />
              </span>
            </button>
          );
        })}
      </div>
    </footer>
  );
}
