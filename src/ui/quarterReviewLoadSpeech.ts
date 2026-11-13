/** 四半期レビューの chunk 失敗文を、同一ランで1回だけ読み上げる。 */
let announced: { scope: string; speech: string } | null = null;

export function readAnnouncedQuarterReviewLoadSpeech(scope: string): string {
  return announced?.scope === scope ? announced.speech : '';
}

export function noteAnnouncedQuarterReviewLoadSpeech(scope: string, speech: string): void {
  announced = { scope, speech };
}

export function resetQuarterReviewLoadSpeech(): void {
  announced = null;
}
