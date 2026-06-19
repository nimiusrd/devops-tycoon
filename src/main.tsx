import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { installGameHook, resolveSeed } from './game';
import './styles.css';

const seed = resolveSeed();
installGameHook(seed);

ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
  <React.StrictMode>
    <App seed={seed} />
  </React.StrictMode>,
);
