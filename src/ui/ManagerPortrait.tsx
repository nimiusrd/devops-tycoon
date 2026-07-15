/**
 * アクションバー左のマネージャー像（プレイヤー＝マネージャーのアイコン）。
 * 旧モック main-screen（git 履歴の mockups/）footer `.focus .mgr` 由来。
 */
export function ManagerPortrait() {
  return (
    <svg
      className="mgr"
      width="52"
      height="58"
      viewBox="0 0 100 110"
      aria-hidden="true"
      data-testid="manager-portrait"
    >
      <path d="M22 108 q0 -30 28 -30 q28 0 28 30 z" fill="#ffb24d" />
      <path d="M38 86 l12 -8 l12 8 l-4 12 h-16z" fill="#fff" />
      <path d="M50 78 l-6 8 l6 6 l6 -6z" fill="#ff7e8b" />
      <circle cx="50" cy="46" r="24" fill="#ffe0c4" />
      <path d="M27 44 q1 -24 23 -24 q22 0 23 22 q-11 -9 -23 -9 q-12 0 -23 11z" fill="#2f2238" />
      <circle cx="42" cy="46" r="3" fill="#33285c" />
      <circle cx="58" cy="46" r="3" fill="#33285c" />
      <path
        d="M41 56 q9 6 18 0"
        stroke="#9a5a4a"
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
      />
    </svg>
  );
}
