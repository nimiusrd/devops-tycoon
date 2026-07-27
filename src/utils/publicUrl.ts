/**
 * `public/` 配下の静的アセット URL を組み立てる。
 *
 * Vite の `base`（`import.meta.env.BASE_URL`）を前置するため、
 * GitHub Pages のプロジェクトサイト（例: `/devops-tycoon/`）でも解決できる。
 */
export function publicUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path.replace(/^\//, '')}`;
}
