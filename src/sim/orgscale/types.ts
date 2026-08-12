/**
 * 組織スケール（巨大組織対応）のドメイン型（SPEC 第4.7〜4.11）。
 *
 * 1 チームの現場（既存の `OrgState`／スプリント）を最下層に、その上へ
 * 部署 → 全社 → 業界 のズーム階層を載せる。すべて描画非依存の純データで、
 * seed付き決定論で導出する（第22.3）。下位の事象は上位へ集約され、上位の
 * レバーは下位の制約をまとめて緩める（第4.7）。
 */
import type { DiagnosisType } from '../run/types';

/** ズーム階層（SPEC 第4.7: 業界 ▸ 全社 ▸ 部署 ▸ 現場）。 */
export type ZoomLevel = 'industry' | 'company' | 'department' | 'team';

/** どの階層を見ているか・どこにフォーカスしているか（カメラ状態）。 */
export interface ZoomState {
  level: ZoomLevel;
  /** 部署ビューでフォーカス中の部門 ID（未選択は null）。 */
  deptId: string | null;
  /** ドリルダウン対象として直近に選んだチーム ID（演出用。未選択は null）。 */
  teamId: string | null;
}

/** チームの健全度（SPEC 第4.8 の色: 緑 / 黄 / 赤）。 */
export type TeamHealth = 'healthy' | 'congested' | 'reviewHell';

/** ランキング種別タブ（SPEC 第4.10: 総合出荷 / 健全経営 / AI活用 / 急成長）。 */
export type RankingKind = 'overall' | 'healthy' | 'ai' | 'growth';

/** 部門の定義（データ駆動。全社マップの部門ゾーンに対応）。 */
export interface DepartmentDef {
  id: string;
  name: string;
  /** 部門ゾーンの色（縦ストライプ）。 */
  color: string;
  /** 基本チーム数。 */
  teamCount: number;
}

/**
 * ラン中に永続するチーム本体（RI-64 / SPEC 第4.7）。
 * 表示用 `Team` の正本であり、粗粒度 sim・施策・入り込みの対象。
 */
export interface TeamRunState {
  id: string;
  deptId: string;
  name: string;
  /**
   * 稼働エンジニア人数（休職除く。粗粒度出荷・表示の正）。
   * 詳細ロスター上限を超える総席数は `headcount` 側で保持する。
   */
  engineers: number;
  /**
   * チーム総席数（休職・ロスター非表示分を含む）。
   * 旧セーブ欠落時は `engineers` と同一とみなす。
   */
  headcount?: number;
  /** AI 習熟度 0..100。 */
  aiLiteracy: number;
  /** AI依存度 0..100。 */
  aiDependency: number;
  /** 士気 0..100。 */
  morale: number;
  /** 技術的負債（累積）。 */
  techDebt: number;
  /** 出荷（このチームの累積成果）。 */
  shipping: number;
  /** レビュー待ち行列（PR の山）。 */
  reviewQueue: number;
  /** 炎上中のインシデント数。 */
  incidents: number;
  /** レビュー耐性の指標 0..100（高いほど行列が減りやすい）。 */
  reviewCapacity: number;
  /** 障害傾向 0..1（粗粒度 tick の炎上発生バイアス）。 */
  incidentBias: number;
  /** シニア体力 0..100。 */
  seniorHp: number;
  /** AI 導入フラグ。 */
  aiEnabled: boolean;
  /** 自動テストによる安全性 0..100。 */
  testCoverage: number;
  /** ドキュメント量 0..100。 */
  documentation: number;
  /** 品質水準 0..100。 */
  quality: number;
  /** セキュリティ水準 0..100（RI-87）。 */
  securityLevel: number;
}

/**
 * 1 チームの島（SPEC 第4.8）。出荷・AI依存度・状態バッジを持ち、
 * アイソメ格子上の座標（gridX/gridY）で配置される。
 * 永続 `TeamRunState` からの投影（表示用）。
 */
export interface Team {
  id: string;
  deptId: string;
  name: string;
  /** アイソメ格子座標（描画は `render/iso.ts` で投影）。 */
  gridX: number;
  gridY: number;
  /** 出荷（このチームの累積成果）。 */
  shipping: number;
  /** AI依存度 0..100。 */
  aiDependency: number;
  /** レビュー待ち行列（PR の山）。渋滞の指標。 */
  reviewQueue: number;
  /** 炎上中のインシデント数。 */
  incidents: number;
  /** 士気 0..100。 */
  morale: number;
  /** 技術的負債（累積）。 */
  techDebt: number;
  /** エンジニア人数。 */
  engineers: number;
  /**
   * AI 配布中の人数（島の AI ボット表示用）。
   * 選択中チームはロスターの `aiAssigned`、他は engineers×aiDependency から推定。
   */
  aiAssignedCount: number;
  /** 健全度（reviewQueue/incidents/aiDependency から導出）。 */
  health: TeamHealth;
  /** プレイヤー強調対象（現在の詳細スプリント対象）。星印・is-player 表示に使う。 */
  isPlayer: boolean;
  /** 現在の詳細スプリント対象（入り込み中）か。Pixi 遷移予測に使う。 */
  isActive: boolean;
}

/** 部署ビューの集約（SPEC 第4.9 の部門HUD）。 */
export interface DepartmentState {
  def: DepartmentDef;
  teams: Team[];
  /** 部門出荷。 */
  shipping: number;
  /** 部門AI依存度（平均）。 */
  aiDependency: number;
  /** 部門レビュー耐性 0..100（行列が短いほど高い）。 */
  reviewResilience: number;
  /** 部門技術的負債。 */
  techDebt: number;
  /** 部門士気（平均）。 */
  morale: number;
  /** 炎上チーム数。 */
  onFire: number;
  /** 部門の健全度（最悪寄り）。 */
  health: TeamHealth;
}

/**
 * 全社マップの集約状態（SPEC 第4.8 の全社HUD）。
 * 部署 → 全社の集約結果と共通基盤・全社スコアを持つ。
 */
export interface OrgScaleState {
  seed: string;
  departments: DepartmentState[];
  /** 全社出荷ポイント。 */
  shipping: number;
  /** チーム総数。 */
  teamCount: number;
  /** 部門数。 */
  deptCount: number;
  /** エンジニア総数。 */
  engineers: number;
  /** 全社AI依存度（平均）。 */
  aiDependency: number;
  /** 全社技術的負債。 */
  techDebt: number;
  /** 全社士気（平均）。 */
  morale: number;
  /** 全社セキュリティ水準（平均。RI-87）。 */
  securityLevel: number;
  /** 炎上中チーム数。 */
  onFire: number;
  /** 組織タイプ診断（現場の診断を全社へ持ち上げる。第13章）。 */
  diagnosis: DiagnosisType;
  /** 共通基盤ハブ（CI / Docs / AIガイドライン）。投資が全チームへ波及（規模効果）。 */
  infra: { ci: number; docs: number; aiGuideline: number };
  /** 四半期予算（全社レバーの原資。第4.7）。 */
  budget: number;
  /** 業界スコア（出荷スコア）。 */
  score: number;
  /** 健全度ランク（S/A/B/C/D）。 */
  healthRank: string;
}

/**
 * 全社レバー・部門レバーが積み上げる恒久調整（規模効果の蓄積）。
 * 生成時に全チーム／対象部門へ波及させる（下位制約をまとめて緩める。第4.7）。
 */
export interface OrgAdjust {
  /** AI依存度への加算（負で抑制。全社AIガイドライン / AIスロットル）。 */
  aiDependencyDelta: number;
  /** レビュー行列への加算（負で短縮。基盤投資 / レビュー応援 / PRサイズ制限）。 */
  reviewQueueDelta: number;
  /** 炎上数への加算（負で鎮火。火消し部隊）。 */
  incidentDelta: number;
  /** 士気への加算。 */
  moraleDelta: number;
  /** 技術的負債への加算（負で返済。標準化 / 依存整理）。 */
  techDebtDelta: number;
  /** チーム増（採用ドラフト / 組織再編）。 */
  extraTeams: number;
  /** 共通基盤ブースト（標準化 / 基盤投資）。 */
  infraBoost: number;
}

/** 全社調整 + 部門別調整 + チーム別調整。生成時にマージして波及させる。 */
export interface OrgAdjustState {
  company: OrgAdjust;
  /** 部門 ID → 部門スコープの調整。 */
  byDept: Record<string, OrgAdjust>;
  /** チーム ID → チームスコープの調整（RI-64）。 */
  byTeam?: Record<string, OrgAdjust>;
}

/** レバー 1 種の定義（データ駆動）。 */
export interface LeverDef {
  id: string;
  name: string;
  /** 適用範囲。company=全社 / department=部署 / team=特定チーム（RI-64）。 */
  scope: 'company' | 'department' | 'team';
  /** 四半期予算コスト。 */
  cost: number;
  /** 効果（OrgAdjust への差分）。 */
  effect: Partial<OrgAdjust>;
  /** 表示用の説明。 */
  description: string;
}

/** 業界ランキングの 1 組織（自社 or 他社）。 */
export interface RivalOrg {
  id: string;
  name: string;
  /** 組織タイプ（第13章の比喩。表示用ラベル）。 */
  orgType: string;
  /** 各ランキング種別のスコア。 */
  scores: Record<RankingKind, number>;
  /** 健全度ランク。 */
  healthRank: string;
  /** 趨勢（▲=1 / →=0 / ▼=-1）。 */
  trend: -1 | 0 | 1;
  /** 自社か。 */
  isSelf: boolean;
}

/** リーダーボードの 1 行。 */
export interface LeaderboardEntry {
  rank: number;
  org: RivalOrg;
}

/** 業界ランキングビュー（SPEC 第4.10）。 */
export interface IndustryState {
  /** 表示中のランキング種別。 */
  kind: RankingKind;
  /** シーズン番号。 */
  season: number;
  /** 所属リーグ。 */
  league: string;
  /** 並べ替え済みリーダーボード。 */
  entries: LeaderboardEntry[];
  /** 自社の順位（1 起点）。 */
  selfRank: number;
  /** 参加組織数。 */
  total: number;
}
