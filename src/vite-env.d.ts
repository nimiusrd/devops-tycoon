/// <reference types="vite/client" />

declare module 'virtual:webgl-modules' {
  export const webglModuleUrls: Record<'board' | 'company' | 'department', string>;
}
