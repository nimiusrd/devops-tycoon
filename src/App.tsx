interface AppProps {
  seed: string;
}

export default function App({ seed }: AppProps) {
  return (
    <main className="shell" aria-labelledby="app-title">
      <section className="hero-card">
        <p className="eyebrow">Phase 0</p>
        <h1 id="app-title">DevOps Tycoon</h1>
        <p className="status">Foundation Ready</p>
        <dl className="seed-panel" aria-label="Current simulation seed">
          <dt>seed</dt>
          <dd>{seed}</dd>
        </dl>
      </section>
    </main>
  );
}
