/**
 * テキストをローカルファイルとして保存する。
 *
 * 切断された `<a>` の `click()` は Firefox 等で無反応になり、
 * `URL.revokeObjectURL` の即時実行は Chromium でダウンロードをキャンセルしうる。
 * DOM へ一時的に接続し、revoke はダウンロード開始後に行う。
 */
const REVOKE_DELAY_MS = 1_000;

export function downloadTextFile(
  filename: string,
  text: string,
  mimeType = 'application/json',
): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (typeof URL.createObjectURL !== 'function') return false;

  let objectUrl: string | null = null;
  let link: HTMLAnchorElement | null = null;
  try {
    const blob = new Blob([text], { type: mimeType });
    objectUrl = URL.createObjectURL(blob);
    link = document.createElement('a');
    link.href = objectUrl;
    link.download = filename;
    link.rel = 'noopener';
    link.style.display = 'none';
    document.body.appendChild(link);
    link.click();
    return true;
  } catch {
    return false;
  } finally {
    const urlToRevoke = objectUrl;
    const nodeToRemove = link;
    globalThis.setTimeout(() => {
      nodeToRemove?.remove();
      if (urlToRevoke) URL.revokeObjectURL(urlToRevoke);
    }, REVOKE_DELAY_MS);
  }
}
