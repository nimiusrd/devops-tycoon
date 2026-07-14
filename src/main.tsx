import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGame } from './game';
import { initializeMetaPersistence } from './state/metaPersistence';
import './styles.css';

async function bootstrap(): Promise<void> {
  const { meta, storage } = await initializeMetaPersistence();
  // 決定論フック window.game を生成し、App へ渡す（描画は状態を読むだけ）。
  const game = installGame({ initialMeta: meta, metaStorage: storage });

  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <App game={game} />
    </React.StrictMode>,
  );
}

void bootstrap();
