import { DEFAULT_SCENARIO } from './sim/scenarios';
import { DEFAULT_SEED } from './sim/seed';
import type { ScenarioId } from './sim/types';

export interface AppProps {
  /** 解決済みの seed（`?seed=` 由来）。 */
  seed?: string;
  /** 適用中のシナリオ。 */
  scenario?: ScenarioId;
}

export default function App({ seed = DEFAULT_SEED, scenario = DEFAULT_SCENARIO }: AppProps) {
  return (
    <main className="shell" aria-labelledby="app-title">
      <section className="hero-card">
        <p className="eyebrow">Phase 0</p>
        <h1 id="app-title">DevOps Tycoon</h1>
        <p className="status">Foundation Ready</p>
        <dl className="seed-panel" aria-label="Current simulation seed">
          <dt>seed</dt>
          <dd data-testid="seed">{seed}</dd>
          <dt>scenario</dt>
          <dd data-testid="scenario">{scenario}</dd>
        </dl>
      </section>
    </main>
  );
}
