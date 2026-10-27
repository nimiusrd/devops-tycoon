/**
 * 日本語を文節の境界だけで折り返す。
 *
 * 空白のない文はブラウザが任意の文字で改行する。語の途中で切れないよう、
 * 各文節を nowrap にし、文節のあいだにだけ改行機会を置く。
 */
import { Fragment } from 'react';

export function PhraseText({ phrases }: { phrases: readonly string[] }) {
  return (
    <>
      {phrases.map((phrase, index) => (
        <Fragment key={`${index}:${phrase}`}>
          {index > 0 && <wbr />}
          <span className="text-phrase">{phrase}</span>
        </Fragment>
      ))}
    </>
  );
}
