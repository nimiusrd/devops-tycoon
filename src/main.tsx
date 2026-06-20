import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGame } from './game';
import './styles.css';

// 決定論フック window.game を生成し、App へ渡す（描画は状態を読むだけ）。
const game = installGame();

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App game={game} />
  </React.StrictMode>,
);
