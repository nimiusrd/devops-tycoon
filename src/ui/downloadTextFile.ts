/**
 * テキストをローカルファイルとして保存する。
 *
 * 切断された `<a>` の `click()` は Firefox 等で無反応になり、
 * `URL.revokeObjectURL` の即時実行は Chromium でダウンロードをキャンセルしうる。
 * DOM へ一時的に接続し、revoke はダウンロード開始後に行う。
 */
const REVOKE_DELAY_MS = 1_000;

/** 書き出しボタンが何も起きなかったとき、プレイヤーへ返す一文。成功時は null。 */
export function persistenceExportMessage(
  text: string | null,
  downloaded: boolean,
  kind: 'run' | 'replay' = 'run',
): string | null {
  const subject = kind === 'replay' ? 'リプレイ' : '途中セーブ';
  if (!text) return `書き出せる${subject}がありません。`;
  if (!downloaded) return `${subject}をファイルに保存できませんでした。`;
  return null;
}

/** 途中セーブと未保存リプレイを同時に書き出したときの失敗文。全部成功なら null。 */
export function persistenceExportMessages(
  parts: readonly { text: string | null; downloaded: boolean; kind?: 'run' | 'replay' }[],
): string | null {
  if (parts.length === 0) return persistenceExportMessage(null, false);
  const messages = parts
    .map((part) => persistenceExportMessage(part.text, part.downloaded, part.kind))
    .filter((message): message is string => message !== null);
  return messages.length > 0 ? messages.join('') : null;
}

export function downloadTextFile(
  filename: string,
  text: string,
  mimeType = 'application/json',
): boolean {
  try {
    return downloadBlobFile(filename, new Blob([text], { type: mimeType }));
  } catch {
    return false;
  }
}

export function downloadBlobFile(filename: string, blob: Blob): boolean {
  if (typeof document === 'undefined' || !document.body) return false;
  if (typeof URL.createObjectURL !== 'function') return false;

  let objectUrl: string | null = null;
  let link: HTMLAnchorElement | null = null;
  try {
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
