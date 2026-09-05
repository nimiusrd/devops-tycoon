import type { Plugin } from 'vite';

const moduleId = 'virtual:webgl-modules';
const resolvedId = `\0${moduleId}`;
const scenes = {
  board: 'BoardPixiLayer',
  company: 'OrgPixiField',
  department: 'DeptPixiBoard',
};

/** 再試行時にURLを変えて取得できるよう、実際に出力したJSチャンクのURLを公開する。 */
export function webglModulesPlugin(): Plugin {
  let build = false;
  return {
    name: 'webgl-module-urls',
    configResolved(config) {
      build = config.command === 'build';
    },
    resolveId(id) {
      if (id === moduleId) return resolvedId;
    },
    load(id) {
      if (id !== resolvedId) return;
      const entries = Object.entries(scenes).map(([key, name]) => {
        const path = `/src/ui/${name}.tsx`;
        const url = build
          ? `import.meta.ROLLUP_FILE_URL_${this.emitFile({
              type: 'chunk',
              preserveSignature: 'strict',
              id: decodeURIComponent(new URL(`.${path}`, import.meta.url).pathname),
              name,
            })}`
          : JSON.stringify(path);
        return `${JSON.stringify(key)}: ${url}`;
      });
      return `export const webglModuleUrls = {${entries.join(',')}};`;
    },
  };
}
