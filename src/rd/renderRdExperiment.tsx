import React from 'react';
import ReactDOM from 'react-dom/client';
import { Issue735ExperimentApp } from './issue735/ExperimentApp';
import type { RdExperimentRef } from './resolveRdExperiment';

/** 通常ゲームを起動せず、R&D 試作だけを載せる。 */
export function renderRdExperiment(rd: RdExperimentRef): void {
  const root = document.getElementById('root');
  if (!root) throw new Error('root が見つからない');
  document.title = `R&D #${rd.id} ${rd.arm} — DevOps Tycoon`;
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <Issue735ExperimentApp rd={rd} />
    </React.StrictMode>,
  );
}
