import { describe, expect, it } from 'vitest';
import { frontmostTitleModal, type TitleModalOpenState } from '../../../src/ui/titleModalStack';

const CLOSED: TitleModalOpenState = {
  help: false,
  metaShop: false,
  deckPolicy: false,
  cardCollection: false,
  achievements: false,
  replayList: false,
};

describe('frontmostTitleModal', () => {
  it('どれも開いていなければ null', () => {
    expect(frontmostTitleModal(CLOSED)).toBeNull();
  });

  it('遊び方だけ開いていれば help', () => {
    expect(frontmostTitleModal({ ...CLOSED, help: true })).toBe('help');
  });

  it('後ろに重ねたリプレイが最前面', () => {
    expect(frontmostTitleModal({ ...CLOSED, help: true, replayList: true })).toBe('replayList');
  });

  it('カードコレクションはメタショップより前面', () => {
    expect(frontmostTitleModal({ ...CLOSED, metaShop: true, cardCollection: true })).toBe(
      'cardCollection',
    );
  });

  it('カードコレクションは遊び方より前面', () => {
    expect(frontmostTitleModal({ ...CLOSED, help: true, cardCollection: true })).toBe(
      'cardCollection',
    );
  });
});
