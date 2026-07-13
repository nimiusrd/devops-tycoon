/**
 * 各工程のキャラ＋机（アイソメ「ステーション」のアクター）。SPEC 第4.1 / 第12章 準拠。
 *
 * `boardScene` が導いた `mood` を受け取り、表情・アニメ（揺れ）を切り替える純表示。
 * 状態は持たず props を読んで描くだけ（第22.2）。将来 PixiJS のスプライトへ
 * 置換しやすいよう、レーンごとの体色/髪/小物だけを変えた 1 つのパラメトリックな
 * ワーカーで構成する（follow-ups フェーズ4「表情演出のスプライト化」への布石）。
 */
import type { Lane } from '../sim/types';
import type { StationMood } from '../render/boardScene';

/** 机（アイソメ）。ローカル座標で天板中心が (110,150) になるよう固定。 */
function Desk({ tone = 'wood' }: { tone?: 'wood' | 'dark' }) {
  const top = tone === 'dark' ? '#5a4a86' : '#caa06a';
  const left = tone === 'dark' ? '#3a2f66' : '#9a7440';
  const right = tone === 'dark' ? '#2b2050' : '#75561f';
  return (
    <g>
      <polygon points="40,150 110,115 180,150 110,185" fill={top} />
      <polygon points="40,150 110,185 110,215 40,180" fill={left} />
      <polygon points="110,185 180,150 180,180 110,215" fill={right} />
      <polyline points="40,150 110,115 180,150" fill="none" stroke="#ffffff22" strokeWidth="1.5" />
      <rect x="38" y="150" width="3.2" height="34" fill="#5a3f18" />
      <rect x="178" y="150" width="3.2" height="34" fill="#5a3f18" />
      <rect x="108" y="185" width="3.2" height="34" fill="#5a3f18" />
    </g>
  );
}

/** 目（表情別）。中心 (50,48) 周辺のローカル座標。 */
function Eyes({ mood, ink }: { mood: StationMood; ink: string }) {
  if (mood === 'happy' || mood === 'cheer') {
    // ニッコリ（^^）
    return (
      <>
        <path
          d="M37 50 q4 -6 9 0"
          stroke={ink}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M54 50 q4 -6 9 0"
          stroke={ink}
          strokeWidth="2.6"
          fill="none"
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === 'tired') {
    // 半目＋クマ
    return (
      <>
        <ellipse cx="42" cy="52" rx="6" ry="2.6" fill="#b98a92" opacity=".5" />
        <ellipse cx="58" cy="52" rx="6" ry="2.6" fill="#b98a92" opacity=".5" />
        <line
          x1="37"
          y1="48"
          x2="47"
          y2="48"
          stroke={ink}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
        <line
          x1="53"
          y1="48"
          x2="63"
          y2="48"
          stroke={ink}
          strokeWidth="2.4"
          strokeLinecap="round"
        />
      </>
    );
  }
  if (mood === 'exhausted') {
    // 疲れ果て: 閉じ目（下がり弧）＋濃いクマ＋汗
    return (
      <>
        <ellipse cx="42" cy="53" rx="6.5" ry="3" fill="#b98a92" opacity=".6" />
        <ellipse cx="58" cy="53" rx="6.5" ry="3" fill="#b98a92" opacity=".6" />
        <path
          d="M37 48 q4 4 9 0"
          stroke={ink}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <path
          d="M54 48 q4 4 9 0"
          stroke={ink}
          strokeWidth="2.4"
          fill="none"
          strokeLinecap="round"
        />
        <ellipse cx="68" cy="36" rx="2.5" ry="3.5" fill="#7bdcff" opacity=".85" />
      </>
    );
  }
  if (mood === 'panic') {
    // 見開き（O O）＋メガネ
    return (
      <>
        <circle cx="42" cy="48" r="8" fill="#ffffff22" stroke={ink} strokeWidth="2.4" />
        <circle cx="58" cy="48" r="8" fill="#ffffff22" stroke={ink} strokeWidth="2.4" />
        <circle cx="42" cy="48" r="3" fill={ink} />
        <circle cx="58" cy="48" r="3" fill={ink} />
        <line x1="50" y1="48" x2="50" y2="48" stroke={ink} strokeWidth="2.4" />
      </>
    );
  }
  if (mood === 'sad') {
    // 困り眉＋伏し目
    return (
      <>
        <path d="M36 44 q5 3 9 1" stroke={ink} strokeWidth="2" fill="none" strokeLinecap="round" />
        <path
          d="M55 45 q4 -2 9 -1"
          stroke={ink}
          strokeWidth="2"
          fill="none"
          strokeLinecap="round"
        />
        <circle cx="42" cy="51" r="2.6" fill={ink} />
        <circle cx="58" cy="51" r="2.6" fill={ink} />
      </>
    );
  }
  // neutral
  return (
    <>
      <circle cx="42" cy="48" r="3" fill={ink} />
      <circle cx="58" cy="48" r="3" fill={ink} />
    </>
  );
}

/** 口（表情別）。 */
function Mouth({ mood }: { mood: StationMood }) {
  if (mood === 'cheer' || mood === 'happy') {
    return (
      <path
        d="M40 58 q10 9 20 0"
        stroke="#9a5a4a"
        strokeWidth="2.6"
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  if (mood === 'panic') {
    return <ellipse cx="50" cy="62" rx="5" ry="6" fill="#3a0f14" />;
  }
  if (mood === 'sad') {
    return (
      <path
        d="M43 63 q7 -4 14 0"
        stroke="#8a4a3a"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  if (mood === 'tired') {
    return (
      <line
        x1="43"
        y1="60"
        x2="57"
        y2="60"
        stroke="#8a4a3a"
        strokeWidth="2.2"
        strokeLinecap="round"
      />
    );
  }
  if (mood === 'exhausted') {
    // へろへろの波線口
    return (
      <path
        d="M44 61 q3 -3 6 0 q3 3 6 0"
        stroke="#8a4a3a"
        strokeWidth="2.2"
        fill="none"
        strokeLinecap="round"
      />
    );
  }
  return (
    <path d="M43 59 q7 4 14 0" stroke="#9a5a4a" strokeWidth="2" fill="none" strokeLinecap="round" />
  );
}

/** レーンごとの見た目（体色・髪・小物・絵文字）。 */
const STYLE: Record<Lane, { body: string; hair: string; skin: string; emoji?: string }> = {
  backlog: { body: '#7a6cc0', hair: '#4a3530', skin: '#ffe0c4' },
  coding: { body: '#4fb3a0', hair: '#5a3a2a', skin: '#ffe0c4', emoji: '✨' },
  review: { body: '#5b6b8c', hair: '#3a3340', skin: '#f4d2b3', emoji: '💧' },
  rework: { body: '#c0728a', hair: '#3a2a40', skin: '#ffe0c4', emoji: '💦' },
  done: { body: '#3fa86e', hair: '#4a3020', skin: '#ffe0c4', emoji: '🎉' },
};

/** bob アニメのクラス（パニックは shake、Coding は fast）。 */
function bobClass(lane: Lane, mood: StationMood): string {
  if (mood === 'panic') return 'cbob shake';
  if (lane === 'coding') return 'cbob fast';
  return 'cbob';
}

export interface StationActorProps {
  lane: Lane;
  mood: StationMood;
}

/**
 * 1 工程ぶんのアクター（机＋キャラ）。中心が CSS で station アンカーに合う前提。
 */
export function StationActor({ lane, mood }: StationActorProps) {
  const s = STYLE[lane];
  const ink = '#33285c';
  const cheering = mood === 'cheer';
  return (
    <svg
      className="station-actor"
      width="210"
      height="190"
      viewBox="0 0 220 200"
      aria-hidden="true"
    >
      <Desk tone={lane === 'coding' ? 'dark' : 'wood'} />
      {/* PC/モニタ（Coding/Review の机に） */}
      {(lane === 'coding' || lane === 'review') && (
        <g>
          <polygon points="92,138 110,130 128,138 110,146" fill="#0e1430" />
          <polygon points="96,137 110,131 110,139 96,145" fill="#3fb6ff" opacity=".85" />
        </g>
      )}
      {/*
       * bob/shake は CSS の transform を animate するため、SVG の transform 属性
       * （アンカー translate）と同じ <g> に置くと CSS が属性を上書きしてアンカーが
       * 外れる。アニメは外側 <g>、アンカー translate は内側 <g> に分けて両立させる。
       */}
      <g className={bobClass(lane, mood)}>
        <g transform="translate(60,4)">
          {/* 胴体 */}
          {cheering ? (
            <>
              <path d="M23 124 q0 -32 27 -32 q27 0 27 32 z" fill={s.body} />
              <path
                d="M27 100 q-10 -22 -2 -34"
                stroke={s.body}
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
              />
              <path
                d="M73 100 q10 -22 2 -34"
                stroke={s.body}
                strokeWidth="9"
                fill="none"
                strokeLinecap="round"
              />
              <circle cx="24" cy="62" r="6" fill={s.skin} />
              <circle cx="76" cy="62" r="6" fill={s.skin} />
            </>
          ) : (
            <path d="M22 124 q0 -32 28 -32 q28 0 28 32 z" fill={s.body} />
          )}
          {/* 頭 */}
          <circle cx="50" cy="48" r="24" fill={s.skin} />
          <path d="M27 46 q1 -24 23 -24 q22 0 23 22 q-11 -9 -23 -9 q-12 0 -23 11z" fill={s.hair} />
          <Eyes mood={mood} ink={ink} />
          <Mouth mood={mood} />
          {/* ほっぺ（上機嫌時） */}
          {(mood === 'happy' || mood === 'cheer') && (
            <>
              <circle cx="35" cy="40" r="3" fill="#ff8fb0" opacity=".7" />
              <circle cx="65" cy="40" r="3" fill="#ff8fb0" opacity=".7" />
            </>
          )}
          {/* 状態絵文字 */}
          {s.emoji && (mood !== 'neutral' || lane === 'coding') && (
            <text x="74" y="28" fontSize="13">
              {s.emoji}
            </text>
          )}
        </g>
      </g>
    </svg>
  );
}
