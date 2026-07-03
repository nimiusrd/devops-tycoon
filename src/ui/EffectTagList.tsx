/**
 * 効果タグの横並び表示（RI-43 基盤。RI-44 以降も再利用）。
 */
import type { EffectTag } from '../render/eventOutcomeView';

export interface EffectTagListProps {
  tags: EffectTag[];
  testId?: string;
}

export function EffectTagList({ tags, testId = 'effect-tags' }: EffectTagListProps) {
  if (tags.length === 0) return null;

  return (
    <div className="effect-tags" data-testid={testId}>
      {tags.map((tag, i) => (
        <span key={i} className={`effect-tag tone-${tag.tone}`} data-tone={tag.tone}>
          {tag.label}
        </span>
      ))}
    </div>
  );
}
