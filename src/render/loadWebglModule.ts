import { webglModuleUrls } from 'virtual:webgl-modules';
import { getWebglAttempt } from './webglStatus';

interface WebglModules {
  board: typeof import('../ui/BoardPixiLayer');
  company: typeof import('../ui/OrgPixiField');
  department: typeof import('../ui/DeptPixiBoard');
}

export function loadWebglModule<K extends keyof WebglModules>(scene: K): Promise<WebglModules[K]> {
  const url = new URL(webglModuleUrls[scene], window.location.href);
  const attempt = getWebglAttempt();
  // 失敗したimportのブラウザキャッシュを避ける。URLはViteが生成した同一ビルドのもの。
  if (attempt > 0) url.searchParams.set('webgl-attempt', String(attempt));
  return import(/* @vite-ignore */ url.href);
}
