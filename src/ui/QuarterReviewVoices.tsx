import { quarterReviewVoicesView } from '../render/quarterReviewVoicesView';
import type { RunState } from '../sim/run/types';

export function QuarterReviewVoices({ state }: { state: RunState }) {
  const view = quarterReviewVoicesView(state);
  if (!view) return null;
  const voices = [view.member, view.customer].filter((voice) => voice !== null);

  return (
    <details className="result-details quarter-voices" data-testid="quarter-voices">
      <summary>現場・顧客の声</summary>
      <p className="quarter-voices-note">
        記録に基づく振り返りです。声の開閉で判定・信頼・報酬は変わりません。
      </p>
      {!view.member && <p>発言できるメンバーの記録がありません。</p>}
      {voices.map((voice, index) => (
        <figure className="quarter-voice" key={index}>
          <figcaption>{voice.speaker}</figcaption>
          <blockquote>{voice.quote}</blockquote>
          <p className="quarter-voices-note">根拠: {voice.basis}</p>
        </figure>
      ))}
    </details>
  );
}
