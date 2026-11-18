/** RI-302: 保存済み記録の隣接フレームを読むだけの観戦クイズ。通常ランへの接続はない。 */
import type { ReplayKeyframe } from '../state/replay';
import { parseReplayShare } from '../state/replayShare';

export const SPECTATOR_QUIZ_LIMITS = {
  replayCharacters: 2_000_000,
  checkpointCharacters: 512,
  keyframes: 256,
  depth: 48,
  nodes: 250_000,
  arrayItems: 5_000,
  stringCharacters: 16_000,
} as const;

export type Prediction = 'increased' | 'unchanged';
type Decision = Prediction | 'skip' | 'unanswered';
type Result<T> = { ok: true; value: T } | { ok: false; reason: string };
const fail = (reason: string): Result<never> => ({ ok: false, reason });
const ok = <T>(value: T): Result<T> => ({ ok: true, value });
const isObject = (v: unknown): v is Record<string, unknown> =>
  v !== null && typeof v === 'object' && !Array.isArray(v);

function bounded(
  v: unknown,
  depth = 0,
  budget = { remaining: SPECTATOR_QUIZ_LIMITS.nodes as number },
): boolean {
  if (depth > SPECTATOR_QUIZ_LIMITS.depth || --budget.remaining < 0) return false;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= SPECTATOR_QUIZ_LIMITS.stringCharacters;
  if (Array.isArray(v))
    return (
      v.length <= SPECTATOR_QUIZ_LIMITS.arrayItems && v.every((x) => bounded(x, depth + 1, budget))
    );
  if (isObject(v))
    return Object.entries(v).every(
      ([k, x]) =>
        k.length <= SPECTATOR_QUIZ_LIMITS.stringCharacters && bounded(x, depth + 1, budget),
    );
  return true;
}

function count(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

/** フレーム全体・label・RNG・結果説明・終端メタデータを公開モデルへ渡さない。 */
function recorded(entry: ReplayKeyframe, index: number) {
  return {
    index,
    phase: entry.phase,
    sprintsPlayed: entry.frame.sprintsPlayed,
    delivered: entry.frame.totals.delivered,
  };
}
type Recorded = ReturnType<typeof recorded>;

/** 現行の保存境界だけを保守的に解釈する。不明な経路を補間しない。 */
function pairIssue(a: ReplayKeyframe, b: ReplayKeyframe): string | null {
  const x = a.frame;
  const y = b.frame;
  if (![x.sprintsPlayed, y.sprintsPlayed, x.totals.delivered, y.totals.delivered].every(count))
    return 'unknown_recorded_count';
  if (x.status !== 'playing' || (b.phase !== 'won' && b.phase !== 'lost' && y.status !== 'playing'))
    return 'inconsistent_status';
  if (
    ![x.quarterNumber, y.quarterNumber, x.sprintIndexInQuarter, y.sprintIndexInQuarter].every(count)
  )
    return 'unknown_recorded_position';
  const delta = y.sprintsPlayed - x.sprintsPlayed;
  const sameQuarter = x.quarterNumber === y.quarterNumber;
  const samePosition = sameQuarter && x.sprintIndexInQuarter === y.sprintIndexInQuarter;
  let adjacent = false;
  switch (a.phase) {
    case 'setup':
      adjacent =
        sameQuarter &&
        y.sprintIndexInQuarter === x.sprintIndexInQuarter + 1 &&
        ((b.phase === 'result' && delta === 1) ||
          (b.phase === 'lost' && (delta === 0 || delta === 1)));
      break;
    case 'result':
      adjacent =
        samePosition && delta === 0 && (b.phase === 'draft' || b.phase === 'quarterReview');
      break;
    case 'draft':
      adjacent = samePosition && delta === 0 && (b.phase === 'setup' || b.phase === 'lost');
      break;
    case 'quarterReview':
      adjacent =
        delta === 0 &&
        ((samePosition && (b.phase === 'won' || b.phase === 'lost')) ||
          (b.phase === 'setup' &&
            y.quarterNumber === x.quarterNumber + 1 &&
            y.sprintIndexInQuarter === 0));
      break;
  }
  if (!adjacent) return 'invalid_recorded_adjacency';
  if (y.totals.delivered < x.totals.delivered) return 'inconsistent_delivered_total';
  return null;
}

export class SpectatorQuiz {
  #current: Recorded;
  #next: Recorded;
  #sourceSha256: string;
  #decision: Decision = 'unanswered';
  #revealed = false;

  private constructor(current: Recorded, next: Recorded, sourceSha256: string) {
    this.#current = current;
    this.#next = next;
    this.#sourceSha256 = sourceSha256;
  }

  static async open(
    raw: unknown,
    currentIndex: number,
    nextIndex: number,
  ): Promise<Result<SpectatorQuiz>> {
    if (typeof raw !== 'string' || raw.length > SPECTATOR_QUIZ_LIMITS.replayCharacters)
      return fail('replay_size');
    let input: unknown;
    try {
      input = JSON.parse(raw);
    } catch {
      return fail('invalid_json');
    }
    if (!bounded(input)) return fail('replay_bounds');
    if (
      !isObject(input) ||
      !Array.isArray(input.keyframes) ||
      input.keyframes.length > SPECTATOR_QUIZ_LIMITS.keyframes
    )
      return fail('keyframe_bounds');
    if (
      !count(currentIndex) ||
      nextIndex !== currentIndex + 1 ||
      nextIndex >= input.keyframes.length
    )
      return fail('non_adjacent_indices');
    const parsed = parseReplayShare(raw);
    if (!parsed.ok) return fail(`replay_${parsed.reason}`);
    const last = parsed.replay.keyframes[parsed.replay.keyframes.length - 1];
    if (
      (last.phase === 'won' || last.phase === 'lost') &&
      (last.frame.totals.delivered !== parsed.replay.outcome.score ||
        last.frame.diagnosis !== parsed.replay.outcome.diagnosis ||
        last.frame.winType !== parsed.replay.outcome.winType ||
        last.frame.loseReason !== parsed.replay.outcome.loseReason)
    )
      return fail('inconsistent_terminal_outcome');
    const a = parsed.replay.keyframes[currentIndex];
    const b = parsed.replay.keyframes[nextIndex];
    const issue = pairIssue(a, b);
    if (issue) return fail(issue);
    // 保存元との対応だけを検査する。署名・真正性・不正回答防止の仕組みではない。
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
    const hash = Array.from(new Uint8Array(digest), (v) => v.toString(16).padStart(2, '0')).join(
      '',
    );
    return ok(new SpectatorQuiz(recorded(a, currentIndex), recorded(b, nextIndex), hash));
  }

  view() {
    return {
      stage: this.#revealed ? 'reveal' : this.#decision === 'unanswered' ? 'question' : 'ready',
      question: {
        metric: 'cumulative-delivered-change',
        choices: ['increased', 'unchanged'],
        recordedCurrent: { ...this.#current },
      },
      decision: this.#decision,
      ...(this.#revealed
        ? {
            reveal: {
              source: 'recorded-replay',
              authenticity: 'unverified-local-record',
              recordedNext: { ...this.#next },
              actual: this.#next.delivered > this.#current.delivered ? 'increased' : 'unchanged',
              correct:
                this.#decision === 'skip'
                  ? null
                  : this.#decision ===
                    (this.#next.delivered > this.#current.delivered ? 'increased' : 'unchanged'),
            },
          }
        : {}),
    };
  }

  answer(prediction: unknown): Result<null> {
    if (this.#decision !== 'unanswered') return fail('already_decided');
    if (prediction !== 'increased' && prediction !== 'unchanged') return fail('unknown_prediction');
    this.#decision = prediction;
    return ok(null);
  }

  skip(): Result<null> {
    if (this.#decision !== 'unanswered') return fail('already_decided');
    this.#decision = 'skip';
    return ok(null);
  }

  reveal(): Result<null> {
    if (this.#decision === 'unanswered') return fail('answer_or_skip_required');
    if (this.#revealed) return fail('already_revealed');
    this.#revealed = true;
    return ok(null);
  }

  /** 未来フレームを含めない進捗。元JSONは呼出側が別に保持する。 */
  checkpoint(): string {
    return JSON.stringify({
      version: 1,
      sourceSha256: this.#sourceSha256,
      currentIndex: this.#current.index,
      nextIndex: this.#next.index,
      decision: this.#decision,
      revealed: this.#revealed,
    });
  }

  static async resume(raw: unknown, checkpoint: unknown): Promise<Result<SpectatorQuiz>> {
    if (
      typeof checkpoint !== 'string' ||
      checkpoint.length > SPECTATOR_QUIZ_LIMITS.checkpointCharacters
    )
      return fail('checkpoint_size');
    let input: unknown;
    try {
      input = JSON.parse(checkpoint);
    } catch {
      return fail('invalid_checkpoint');
    }
    if (
      !isObject(input) ||
      input.version !== 1 ||
      typeof input.sourceSha256 !== 'string' ||
      typeof input.currentIndex !== 'number' ||
      typeof input.nextIndex !== 'number' ||
      typeof input.decision !== 'string' ||
      !['unanswered', 'increased', 'unchanged', 'skip'].includes(input.decision) ||
      typeof input.revealed !== 'boolean' ||
      (input.revealed && input.decision === 'unanswered') ||
      Object.keys(input).sort().join(',') !==
        'currentIndex,decision,nextIndex,revealed,sourceSha256,version'
    )
      return fail('invalid_checkpoint');
    const opened = await SpectatorQuiz.open(raw, input.currentIndex, input.nextIndex);
    if (!opened.ok) return opened;
    const quiz = opened.value;
    if (quiz.#sourceSha256 !== input.sourceSha256) return fail('checkpoint_source_mismatch');
    quiz.#decision = input.decision as Decision;
    quiz.#revealed = input.revealed;
    return ok(quiz);
  }
}
