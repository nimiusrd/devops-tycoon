/**
 * スプリント盤面の「シーン計画」（SPEC 第4.1 / 第18章 / mockups/main-screen 準拠）。
 *
 * 何を・どこに描くかを純TSで決める（GPU 不要 → Vitest で数値検証できる。第22.5）。
 * Backlog▸Coding▸Review▸Rework▸Done の各工程を、俯瞰オフィスのアイソメ「ステーション」
 * として配置し、各ステーションのキャラ表情・吹き出し・周囲に積むタスク粒を、
 * スプリント状態から導出する。座標は mockup と同じ設計空間（1404×573）で返し、
 * レンダラ（DOM/SVG → 将来 PixiJS）は「読んで描くだけ」にする（第22.2）。
 */
import type { Lane, Task } from '../sim/types';
import type { TaskSize, TaskVariant } from './taskView';
import { taskSize, taskVariant } from './taskView';

/** 設計座標空間（mockups/main-screen.html の viewBox と一致）。 */
export const BOARD_VIEW = { w: 1404, h: 573 } as const;

/** ステーションのキャラ表情（状態から導出）。 */
export type StationMood = 'neutral' | 'happy' | 'tired' | 'panic' | 'sad' | 'cheer';

/** 設計座標の点。 */
interface Point {
  x: number;
  y: number;
}

/** 1 工程ぶんの静的レイアウト定義（mockup の座標を基準にする）。 */
interface StationLayout {
  lane: Lane;
  label: string;
  icon: string;
  /** キャラ＋机の中心（設計px）。 */
  anchor: Point;
  /** ラベルの位置（設計px）。 */
  label_at: Point;
  /** 吹き出しの位置（設計px）。 */
  bubble_at: Point;
  /** タスク粒を積む中心（机の天板あたり。設計px）。 */
  pile: Point;
  /** 粒を 1 行に並べる最大数（Review は多めに積んで渋滞を見せる）。 */
  perRow: number;
  /** 表示する粒の上限（超過は +N で集約）。 */
  cap: number;
}

/**
 * 5 工程のステーション配置（mockups/main-screen.html の station 座標準拠）。
 * Backlog → Coding → Review（中央・手前）→ Rework（右奥）→ Done（右手前）。
 */
const STATIONS: readonly StationLayout[] = [
  {
    lane: 'backlog',
    label: 'Backlog',
    icon: '📥',
    anchor: { x: 526, y: 203 },
    label_at: { x: 526, y: 178 },
    bubble_at: { x: 556, y: 150 },
    pile: { x: 526, y: 168 },
    perRow: 3,
    cap: 12,
  },
  {
    lane: 'coding',
    label: 'Coding',
    icon: '💻',
    anchor: { x: 622, y: 251 },
    label_at: { x: 622, y: 226 },
    bubble_at: { x: 652, y: 200 },
    pile: { x: 622, y: 214 },
    perRow: 3,
    cap: 12,
  },
  {
    lane: 'review',
    label: 'Review',
    icon: '🔍',
    anchor: { x: 742, y: 285 },
    label_at: { x: 742, y: 238 },
    bubble_at: { x: 772, y: 212 },
    pile: { x: 744, y: 300 },
    perRow: 5,
    cap: 20,
  },
  {
    lane: 'rework',
    label: 'Rework',
    icon: '↩️',
    anchor: { x: 1006, y: 229 },
    label_at: { x: 1006, y: 200 },
    bubble_at: { x: 1036, y: 174 },
    pile: { x: 1006, y: 190 },
    perRow: 3,
    cap: 12,
  },
  {
    lane: 'done',
    label: 'Done',
    icon: '📦',
    anchor: { x: 1075, y: 370 },
    label_at: { x: 1030, y: 312 },
    bubble_at: { x: 1060, y: 286 },
    pile: { x: 1006, y: 330 },
    perRow: 4,
    cap: 14,
  },
];

/** ステーション間のタスクフロー（破線矢印。設計px）。 */
export interface BoardFlow {
  from: Lane;
  to: Lane;
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** 手戻り（Review→Rework）は赤系の差し戻し線。 */
  rework: boolean;
}

const FLOWS: readonly BoardFlow[] = [
  { from: 'backlog', to: 'coding', x1: 552, y1: 232, x2: 600, y2: 252, rework: false },
  { from: 'coding', to: 'review', x1: 656, y1: 280, x2: 710, y2: 300, rework: false },
  { from: 'review', to: 'rework', x1: 812, y1: 280, x2: 958, y2: 250, rework: true },
  { from: 'review', to: 'done', x1: 822, y1: 320, x2: 970, y2: 350, rework: false },
  { from: 'rework', to: 'review', x1: 970, y1: 240, x2: 800, y2: 268, rework: true },
];

/** 進捗中タスクをフロー上へ載せる対象レーン（RI-05）。 */
const FLOWING_LANES: Partial<Record<Lane, Lane>> = {
  coding: 'review',
  rework: 'review',
};

/** from→to のフロー定義を返す。 */
export function findBoardFlow(from: Lane, to: Lane): BoardFlow | undefined {
  return FLOWS.find((f) => f.from === from && f.to === to);
}

/** フロー線上の t (0..1) に対応する設計座標と方向を返す（純関数・Vitest 検証用）。 */
export function flowPointAt(
  flow: BoardFlow,
  t: number,
): { x: number; y: number; angleDeg: number } {
  const clamped = Math.max(0, Math.min(1, t));
  const dx = flow.x2 - flow.x1;
  const dy = flow.y2 - flow.y1;
  return {
    x: flow.x1 + dx * clamped,
    y: flow.y1 + dy * clamped,
    angleDeg: (Math.atan2(dy, dx) * 180) / Math.PI,
  };
}

/** レーン内 progress に応じてフロー上を流すか（sim の Task.progress と一致）。 */
function isFlowingTask(lane: Lane, task: Task): boolean {
  if (task.progress <= 0) return false;
  if (lane === 'rework' && task.incident) return false;
  return lane in FLOWING_LANES;
}

function splitLaneTasks(lane: Lane, tasks: Task[]): { stationary: Task[]; flowing: Task[] } {
  const stationary: Task[] = [];
  const flowing: Task[] = [];
  for (const task of tasks) {
    if (isFlowingTask(lane, task)) flowing.push(task);
    else stationary.push(task);
  }
  return { stationary, flowing };
}

function planFlowingDot(task: Task, lane: Lane): BoardDotPlan | null {
  const to = FLOWING_LANES[lane];
  if (!to) return null;
  const flow = findBoardFlow(lane, to);
  if (!flow) return null;
  const { x, y, angleDeg } = flowPointAt(flow, task.progress);
  return {
    id: task.id,
    lane,
    x,
    y,
    variant: taskVariant(task),
    size: taskSize(task),
    fire: task.incident,
    motion: {
      kind: 'flow',
      from: lane,
      to,
      t: task.progress,
      angleDeg,
      speedMul: task.aiAssisted ? 1.35 : 1,
    },
  };
}

/** レンダラが読む 1 ステーションの描画計画。 */
export interface BoardStationPlan {
  lane: Lane;
  label: string;
  icon: string;
  count: number;
  /** キャラ＋机の中心（設計px）。 */
  x: number;
  y: number;
  labelX: number;
  labelY: number;
  bubbleX: number;
  bubbleY: number;
  /** Review が渋滞しているか（赤いラベル＋パニック表情）。 */
  hot: boolean;
  /**
   * 渋滞の段階強度 0..1（Review のみ非ゼロ）。hot の手前から徐々に上がり、
   * 盤面の赤みを段階的に強める（早期の視覚警告。第18.2）。
   */
  heat: number;
  mood: StationMood;
  /** 吹き出しの文言（無ければ null）。 */
  bubble: string | null;
  /**
   * 上限超過で山に描けなかった件数（0 なら超過なし）。山の見た目が実際の滞留量より
   * 小さく見えないよう、レンダラは >0 のとき `+N` を山の頂点付近に出す（旧 Done +N 相当）。
   */
  overflow: number;
  /** `+N` バッジの表示位置（山の頂点の少し上。設計px）。 */
  overflowX: number;
  overflowY: number;
}

/** 工程間フロー上を流れている粒の motion メタデータ（RI-05）。 */
export interface BoardDotMotion {
  kind: 'flow';
  from: Lane;
  to: Lane;
  /** フロー線上の進行度 0..1。 */
  t: number;
  /** フロー方向（度）。CSS の微小ドリフト用。 */
  angleDeg: number;
  /** 視覚速度係数（AI 粒は少し速く見せる）。 */
  speedMul: number;
}

/** レンダラが読む 1 タスク粒の描画計画。 */
export interface BoardDotPlan {
  id: number;
  lane: Lane;
  /** 設計px の中心座標（奥→手前で安定ソート済み）。 */
  x: number;
  y: number;
  variant: TaskVariant;
  size: TaskSize;
  /** 炎上中（flame を出す）。 */
  fire: boolean;
  /** 設定時は工程間フロー上を流れている（山ではなくレーン間移動中）。 */
  motion?: BoardDotMotion;
}

/** 盤面 1 フレームの描画計画。 */
export interface BoardScenePlan {
  view: { w: number; h: number };
  stations: BoardStationPlan[];
  dots: BoardDotPlan[];
  flows: readonly BoardFlow[];
}

/** Review がこの件数以上で「渋滞（hot）」とみなす（第18.2）。 */
export const REVIEW_HOT_QUEUE = 12;

/** この件数から渋滞 heat が立ち上がる（hot 手前の早期警告の起点）。 */
export const REVIEW_HEAT_START = 4;

/**
 * Review 件数 → 渋滞 heat 0..1 を導く（純関数）。
 * START 以下は 0、HOT 以上は 1。間を線形に上げ、8〜11 件で徐々に赤くなる。
 */
export function reviewHeat(count: number): number {
  if (count <= REVIEW_HEAT_START) return 0;
  if (count >= REVIEW_HOT_QUEUE) return 1;
  return (count - REVIEW_HEAT_START) / (REVIEW_HOT_QUEUE - REVIEW_HEAT_START);
}

/** 粒クラスタの横間隔と段差（設計px）。 */
const DOT_DX = 22;
const DOT_DY = 16;

/**
 * n 個の粒を、アンカー上に「下から積み上がる山」状のオフセットで配置する。
 * 行ごとに上へ（-y）ずらし、各行は中央寄せ。決定論（index のみに依存）なので
 * 同一状態＝同一フレームになり、スクショ比較が安定する（第22.5）。
 */
function pileOffsets(n: number, perRow: number): Point[] {
  const out: Point[] = [];
  const rows = Math.ceil(n / perRow);
  for (let i = 0; i < n; i += 1) {
    const row = Math.floor(i / perRow);
    const col = i % perRow;
    // この行に実際に並ぶ数（最終行は端数）。
    const inRow = row === rows - 1 ? n - row * perRow : perRow;
    const dx = (col - (inRow - 1) / 2) * DOT_DX;
    const dy = -row * DOT_DY;
    out.push({ x: dx, y: dy });
  }
  return out;
}

/** Backlog の吹き出し: 山積みのとき。 */
function backlogMood(count: number): { mood: StationMood; bubble: string | null } {
  return count >= 8 ? { mood: 'tired', bubble: '山積みだ…' } : { mood: 'neutral', bubble: null };
}

/** Coding の吹き出し: AI タスクが流れていると上機嫌。 */
function codingMood(hasAi: boolean): { mood: StationMood; bubble: string | null } {
  return hasAi ? { mood: 'happy', bubble: 'AIサイコー！' } : { mood: 'neutral', bubble: null };
}

/** Review の表情: 渋滞でパニック、PR があれば疲れ顔。 */
function reviewMood(count: number, hot: boolean): { mood: StationMood; bubble: string | null } {
  if (hot) return { mood: 'panic', bubble: 'レビュー終わらん…' };
  if (count > 0) return { mood: 'tired', bubble: null };
  return { mood: 'neutral', bubble: null };
}

/** Rework の表情: 差し戻しがあると沈む。 */
function reworkMood(count: number): { mood: StationMood; bubble: string | null } {
  return count > 0 ? { mood: 'sad', bubble: '動いてない…' } : { mood: 'neutral', bubble: null };
}

/** Done の表情: 出荷が出ているとガッツポーズ。 */
function doneMood(count: number): { mood: StationMood; bubble: string | null } {
  return count > 0 ? { mood: 'cheer', bubble: 'やったー！🎉' } : { mood: 'neutral', bubble: null };
}

function deriveMood(
  lane: Lane,
  count: number,
  hot: boolean,
  hasAi: boolean,
): { mood: StationMood; bubble: string | null } {
  switch (lane) {
    case 'backlog':
      return backlogMood(count);
    case 'coding':
      return codingMood(hasAi);
    case 'review':
      return reviewMood(count, hot);
    case 'rework':
      return reworkMood(count);
    case 'done':
      return doneMood(count);
  }
}

/**
 * スプリントのタスク配列から、盤面 1 フレームの描画計画を組み立てる。
 *
 * - 各工程のステーションは常に描く（count 0 でも表情 neutral で存在）。
 * - 粒は各ステーションの pile を中心に山状に積む（cap 超過は overflow に集約）。
 * - Coding/Rework で progress>0 の粒は工程間フロー上へ補間配置する（RI-05）。
 * - 炎上中のタスクは fire を立て、Review の渋滞で hot/パニック表情にする。
 * 純関数・決定論（入力が同じなら同じ計画）。
 */
export function planBoardScene(tasks: readonly Task[]): BoardScenePlan {
  const byLane = new Map<Lane, Task[]>();
  for (const s of STATIONS) byLane.set(s.lane, []);
  for (const t of tasks) byLane.get(t.lane)?.push(t);

  const stations: BoardStationPlan[] = [];
  const dots: BoardDotPlan[] = [];

  for (const layout of STATIONS) {
    const laneTasks = byLane.get(layout.lane) ?? [];
    const { stationary, flowing } = splitLaneTasks(layout.lane, laneTasks);
    const count = laneTasks.length;
    const hot = layout.lane === 'review' && count >= REVIEW_HOT_QUEUE;
    const heat = layout.lane === 'review' ? reviewHeat(count) : 0;
    const hasAi = laneTasks.some((t) => t.aiAssisted);
    const { mood, bubble } = deriveMood(layout.lane, count, hot, hasAi);

    // 上限超過時も炎上タスクは必ず残す（fire メーター/緊急対応が依存するため）。
    // 上限内をまず通常タスクで埋め、炎上は最後＝最上段に積んで目立たせる。
    // フロー上を流れる粒は山に含めない（RI-05）。
    const incidents = stationary.filter((t) => t.incident);
    const normals = stationary.filter((t) => !t.incident);
    const shownIncidents = incidents.slice(0, layout.cap);
    const normalSlots = Math.max(0, layout.cap - shownIncidents.length);
    const shownNormals = normals.slice(0, normalSlots);
    const shown = [...shownNormals, ...shownIncidents];
    const overflow = count - shown.length;

    // `+N` バッジは山の頂点（最上段の少し上）に置く。ラベルと衝突させない。
    const rows = Math.ceil(shown.length / layout.perRow);
    const apexDy = rows > 0 ? -(rows - 1) * DOT_DY : 0;

    stations.push({
      lane: layout.lane,
      label: layout.label,
      icon: layout.icon,
      count,
      x: layout.anchor.x,
      y: layout.anchor.y,
      labelX: layout.label_at.x,
      labelY: layout.label_at.y,
      bubbleX: layout.bubble_at.x,
      bubbleY: layout.bubble_at.y,
      hot,
      heat,
      mood,
      bubble,
      overflow,
      overflowX: layout.pile.x,
      overflowY: layout.pile.y + apexDy - 26,
    });

    const offsets = pileOffsets(shown.length, layout.perRow);
    shown.forEach((t, i) => {
      const off = offsets[i];
      dots.push({
        id: t.id,
        lane: layout.lane,
        x: layout.pile.x + off.x,
        y: layout.pile.y + off.y,
        variant: taskVariant(t),
        size: taskSize(t),
        fire: t.incident,
      });
    });

    for (const task of flowing) {
      const dot = planFlowingDot(task, layout.lane);
      if (dot) dots.push(dot);
    }
  }

  return { view: { w: BOARD_VIEW.w, h: BOARD_VIEW.h }, stations, dots, flows: FLOWS };
}
