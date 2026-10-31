/** 同じ文を再マウントで空に戻して、もう一度読み上げない。 */
let announcedSpeech = '';

export function readAnnouncedLeaveReturnSpeech(): string {
  return announcedSpeech;
}

export function noteAnnouncedLeaveReturnSpeech(speech: string): void {
  announcedSpeech = speech;
}

/** テスト間で読み上げ済みの文を捨てる。 */
export function resetLeaveReturnSpeech(): void {
  announcedSpeech = '';
}
