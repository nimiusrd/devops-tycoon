import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { AudioProvider } from './audio/AudioProvider';
import { installGame } from './game';
import { initializeMetaPersistence } from './state/metaPersistence';
import { initializeReplayPersistence } from './state/replayPersistence';
import { initializeRunPersistence } from './state/runPersistence';
import './styles.css';
import { applyVisualTokenCssVariables } from './render/visualTokens';

// CSS と Pixi が同じ表示用トークンを参照するよう、DOM の描画開始前に custom property を注入する。
applyVisualTokenCssVariables(document.documentElement);

// E2E / デバッグ用の決定論フックは従来どおり同期的に公開する。
const game = installGame({ metaReady: false });
const [{ meta, storage }, { save: runSave, storage: runStorage }, { storage: replayStorage }] =
  await Promise.all([
    initializeMetaPersistence(),
    initializeRunPersistence(),
    initializeReplayPersistence(),
  ]);
game.attachMetaPersistence(meta, storage);
game.attachRunPersistence(runStorage, runSave);
await game.attachReplay(replayStorage);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <AudioProvider>
      <App game={game} />
    </AudioProvider>
  </React.StrictMode>,
);
