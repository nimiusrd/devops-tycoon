/** 一覧から消えた選択 ID を、残っている先頭へ同期する。 */
export function resolveSelectedReplayId(
  replays: readonly { id: string }[],
  selectedId: string | null,
): string | null {
  if (selectedId && replays.some((replay) => replay.id === selectedId)) return selectedId;
  return replays[0]?.id ?? null;
}
