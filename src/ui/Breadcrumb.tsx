/**
 * ズーム階層のパンくず（SPEC 第4.7）。
 *
 * 業界 ▸ 全社 ▸ 部署 ▸ 現場 を自由に行き来する。下位ほど「手を動かす」、
 * 上位ほど「俯瞰して采配する」。現在地をハイライトする。
 */
import type { ZoomLevel } from '../sim/orgscale/types';

const STEPS: { level: ZoomLevel; icon: string; label: string }[] = [
  { level: 'industry', icon: '🌏', label: '業界' },
  { level: 'company', icon: '🗺', label: '全社' },
  { level: 'department', icon: '🏢', label: '部署' },
  { level: 'team', icon: '💻', label: '現場' },
];

const ORDER: ZoomLevel[] = ['industry', 'company', 'department', 'team'];

export interface BreadcrumbProps {
  level: ZoomLevel;
  onNavigate: (level: ZoomLevel) => void;
}

export function Breadcrumb({ level, onNavigate }: BreadcrumbProps) {
  const current = ORDER.indexOf(level);
  return (
    <nav className="breadcrumb" data-testid="breadcrumb" aria-label="ズーム階層">
      {STEPS.map((step, i) => (
        <span key={step.level} className="breadcrumb-step">
          {i > 0 && <span className="breadcrumb-sep">▸</span>}
          <button
            type="button"
            className={`breadcrumb-btn${step.level === level ? ' active' : ''}`}
            data-testid={`crumb-${step.level}`}
            data-active={step.level === level}
            aria-current={step.level === level ? 'page' : undefined}
            onClick={() => onNavigate(step.level)}
            title={`${step.label}へ`}
          >
            <span aria-hidden>{step.icon}</span>
            <span className="breadcrumb-label">{step.label}</span>
          </button>
        </span>
      ))}
      <span className="breadcrumb-hint">
        {current <= 1 ? '俯瞰して采配' : current === 2 ? 'ボトルネックを診断' : '手を動かす'}
      </span>
    </nav>
  );
}
