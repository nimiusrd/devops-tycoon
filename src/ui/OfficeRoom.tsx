/**
 * 俯瞰オフィスの静的背景（床・壁・島スラブ・装飾）。SPEC 第4.1 / mockups/main-screen 準拠。
 *
 * アイソメの部屋そのものは状態に依存しない背景なので、ここは純粋な SVG。
 * viewBox は boardScene の設計空間（1404×573）と一致させ、`preserveAspectRatio="none"`
 * で盤面いっぱいに伸ばす。ステーション/粒は同じ設計座標の % で重ねる（Board.tsx）。
 */
export function OfficeRoom() {
  return (
    <svg
      className="office-room"
      viewBox="0 0 1404 573"
      preserveAspectRatio="none"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="ot-wallL" x1="0" y1="0" x2="1" y2="0.5">
          <stop offset="0" stopColor="#3a2f68" />
          <stop offset="1" stopColor="#2c2153" />
        </linearGradient>
        <linearGradient id="ot-wallR" x1="1" y1="0" x2="0" y2="0.5">
          <stop offset="0" stopColor="#2e2552" />
          <stop offset="1" stopColor="#231a44" />
        </linearGradient>
        <linearGradient id="ot-floor" x1="0.5" y1="0" x2="0.5" y2="1">
          <stop offset="0" stopColor="#3b2f66" />
          <stop offset="1" stopColor="#241a44" />
        </linearGradient>
        <linearGradient id="ot-sky" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#ffcaa0" />
          <stop offset=".5" stopColor="#ff9e7a" />
          <stop offset="1" stopColor="#9a6bb0" />
        </linearGradient>
        <radialGradient id="ot-lamp" cx="0.5" cy="0.15" r="0.75">
          <stop offset="0" stopColor="#fff3cf" stopOpacity=".26" />
          <stop offset="1" stopColor="#fff3cf" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* 壁と床 */}
      <polygon points="702,6 142,286 142,398 702,118" fill="url(#ot-wallL)" />
      <polygon points="702,6 1262,286 1262,398 702,118" fill="url(#ot-wallR)" />
      <path d="M702 118 L1262 398 L702 678 L142 398 Z" fill="url(#ot-floor)" />

      {/* 床タイルのグリッド線 */}
      <path
        d="M702 118 L1262 398 M622 158 L1182 438 M542 198 L1102 478 M462 238 L1022 518 M382 278 L942 558 M302 318 L862 598 M222 358 L782 638 M142 398 L702 678 M702 118 L142 398 M782 158 L222 438 M862 198 L302 478 M942 238 L382 518 M1022 278 L462 558 M1102 318 L542 598 M1182 358 L622 638 M1262 398 L702 678"
        fill="none"
        stroke="#ffffff1c"
        strokeWidth="1.5"
      />
      {/* 壁トップのハイライト＋巾木 */}
      <polyline points="702,6 142,286" fill="none" stroke="#ffffff18" strokeWidth="2" />
      <polyline points="702,6 1262,286" fill="none" stroke="#ffffff12" strokeWidth="2" />
      <path d="M702 118 L702 6" stroke="#15102e" strokeWidth="3" />
      <polyline
        points="142,398 702,118 1262,398"
        fill="none"
        stroke="#574a8c"
        strokeWidth="2.5"
        opacity=".75"
      />

      {/* 壁の窓（夕景） */}
      <polygon points="903.6,120.2 1138.8,237.8 1138.8,298.3 903.6,180.7" fill="#1d1640" />
      <polygon points="909.2,125.3 1133.2,237.3 1133.2,293.3 909.2,181.3" fill="url(#ot-sky)" />
      <circle cx="1082.8" cy="230" r="17" fill="#fff0c0" opacity=".9" />
      <line x1="1021.2" y1="181.3" x2="1021.2" y2="237.3" stroke="#1d1640" strokeWidth="5" />
      <line x1="909.2" y1="153.3" x2="1133.2" y2="265.3" stroke="#1d1640" strokeWidth="5" />
      {/* 壁掛けの時計 */}
      <circle cx="769.2" cy="77.7" r="22" fill="#2a2150" stroke="#6a57ad" strokeWidth="4" />
      <circle cx="769.2" cy="77.7" r="3" fill="#ffd45c" />
      <line
        x1="769.2"
        y1="77.7"
        x2="769.2"
        y2="63.7"
        stroke="#ffd45c"
        strokeWidth="3"
        strokeLinecap="round"
      />
      <line
        x1="769.2"
        y1="77.7"
        x2="781.2"
        y2="82.7"
        stroke="#ffd45c"
        strokeWidth="3"
        strokeLinecap="round"
      />

      {/* レビュー島のスポットライト */}
      <ellipse cx="742" cy="434" rx="300" ry="150" fill="url(#ot-lamp)" />

      {/* 島スラブ（各ステーションが乗る台座）。Review は赤系。 */}
      <g stroke="#564897" strokeWidth="1.5">
        <polygon points="526,212 662,280 526,348 390,280" fill="#3f3470" />
        <polygon points="622,244 782,324 622,404 462,324" fill="#3f3470" />
        <polygon points="742,264 942,364 742,464 542,364" fill="#4a2b45" stroke="#73436b" />
        <polygon points="1006,236 1134,300 1006,364 878,300" fill="#3f3470" />
        <polygon points="1038,332 1190,408 1038,484 886,408" fill="#32414c" stroke="#4a656f" />
      </g>

      {/* 技術的負債のヘドロ（左手前） */}
      <g transform="translate(372,452)">
        <ellipse cx="0" cy="0" rx="120" ry="40" fill="#0e0a0c" opacity=".7" />
        <ellipse cx="-46" cy="-8" rx="34" ry="13" fill="#160f14" />
        <ellipse cx="44" cy="6" rx="46" ry="15" fill="#160f14" />
        <circle cx="-10" cy="-8" r="6" fill="#1f151c" />
        <circle cx="24" cy="-3" r="5" fill="#1f151c" />
      </g>

      {/* 観葉植物（右手前） */}
      <g transform="translate(1190,430)">
        <ellipse cx="0" cy="34" rx="40" ry="14" fill="#0b0712" opacity=".3" />
        <path d="M0 36 l-16 -40 h32 z" fill="#a86a3a" />
        <path d="M0 -2 q-26 -34 -8 -64 q14 22 8 64" fill="#3fa86e" />
        <path d="M0 -2 q26 -30 10 -60 q-12 22 -10 60" fill="#48b878" />
        <path d="M0 -2 q-2 -40 2 -56 q8 24 -2 56" fill="#57c888" />
      </g>
    </svg>
  );
}
