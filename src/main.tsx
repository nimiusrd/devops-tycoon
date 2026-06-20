import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGame } from './game';
import './styles.css';

// 決定論フック window.game を生成し、解決済み seed を UI へ渡す。
const game = installGame();
const { seed, scenario } = game.getState();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App seed={seed} scenario={scenario} />
  </React.StrictMode>,
);
