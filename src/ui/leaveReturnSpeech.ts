/** 同じ文を、同じ編成画面の再マウントで空に戻して、もう一度読み上げない。チーム切替はスコープごとに残す。 */
const announcedByScope = new Map<string, string>();

export function readAnnouncedLeaveReturnSpeech(scope: string): string {
  return announcedByScope.get(scope) ?? '';
}

export function noteAnnouncedLeaveReturnSpeech(scope: string, speech: string): void {
  announcedByScope.set(scope, speech);
}

/** テスト間で読み上げ済みの文を捨てる。 */
export function resetLeaveReturnSpeech(): void {
  announcedByScope.clear();
}
