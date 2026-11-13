/** 同じ文を、同じランとチームの再マウントで空に戻して、もう一度読み上げない。 */
let announced: { scope: string; speech: string } | null = null;

export function readAnnouncedLeaveReturnSpeech(scope: string): string {
  return announced?.scope === scope ? announced.speech : '';
}

export function noteAnnouncedLeaveReturnSpeech(scope: string, speech: string): void {
  announced = { scope, speech };
}

/** テスト間で読み上げ済みの文を捨てる。 */
export function resetLeaveReturnSpeech(): void {
  announced = null;
}
