import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AudioProvider } from './audio/AudioProvider';
import { installGame } from './game';
import { initializeMetaPersistence } from './state/metaPersistence';
import { initializeRunPersistence } from './state/runPersistence';
import './styles.css';

// E2E / デバッグ用の決定論フックは従来どおり同期的に公開する。
const game = installGame({ metaReady: false });
const [{ meta, storage }, { save: runSave, storage: runStorage }] = await Promise.all([
  initializeMetaPersistence(),
  initializeRunPersistence(),
]);
game.attachMetaPersistence(meta, storage);
game.attachRunPersistence(runStorage, runSave);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AudioProvider>
      <App game={game} />
    </AudioProvider>
  </React.StrictMode>,
);
