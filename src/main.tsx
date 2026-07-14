import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGame } from './game';
import { initializeMetaPersistence } from './state/metaPersistence';
import './styles.css';

// E2E / デバッグ用の決定論フックは従来どおり同期的に公開する。
const game = installGame({ metaReady: false });
const { meta, storage } = await initializeMetaPersistence();
game.attachMetaPersistence(meta, storage);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App game={game} />
  </React.StrictMode>,
);
