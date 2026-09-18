/** 称号演出は最初の展開で開始し、以後の開閉では再マウントしない。 */
export function nextTitleCeremonyStarted(started: boolean, detailsOpen: boolean): boolean {
  return started || detailsOpen;
}
