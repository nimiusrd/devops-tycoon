import React from 'react';
import ReactDOM from 'react-dom/client';
import { RdInterveneApp } from './RdInterveneApp';

/** 本番の installGame / 永続化を踏まず、試作 UI だけを載せる。 */
export function mountRdInterveneApp(): void {
  const root = document.getElementById('root');
  if (!root) {
    throw new Error('root element is missing');
  }
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <RdInterveneApp />
    </React.StrictMode>,
  );
}
