/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 * レイアウトは司令室 UI の構図を使い、文言は SPEC の用語に揃える。
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { DIFFICULTY_DEFS, DIFFICULTY_ORDER, TRIAL_DEFS, getTrial } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, getDailyRecord, utcDateStr, type MetaState } from '../state/meta';
import { loadStartRecipe, serializeStartRecipe } from '../state/startRecipe';
import type { RunSaveCompatibilityIssue, RunSaveSummary } from '../state/runPersistence';
import type { DifficultyId } from '../sim/run/types';
import { DEFAULT_SCENARIO, SCENARIO_ORDER, getScenario } from '../sim/scenarios';
import type { ScenarioId } from '../sim/types';
import { publicUrl } from '../utils/publicUrl';

const DIFFICULTY_TAG: Record<DifficultyId, string> = {
  easy: 'Easy',
  normal: 'Normal',
  hard: 'Hard',
  nightmare: 'Nightmare',
};

const PHASE_LABEL: Record<RunSaveSummary['phase'], string> = {
  setup: '編成',
  result: 'リザルト',
  draft: 'ドラフト',
  evolution: '進化',
  beat: 'イベント',
  shop: 'ショップ',
  rest: '休息',
  recruit: '採用',
  quarterReview: '四半期レビュー',
};

function formatRuleset(ruleset: { version: number; fingerprint: string }): string {
  const fingerprint =
    ruleset.fingerprint.length > 12 ? `${ruleset.fingerprint.slice(0, 12)}…` : ruleset.fingerprint;
  return `v${ruleset.version} / ${fingerprint}`;
}

export interface TitleScreenProps {
  seed: string;
  meta: MetaState;
  onStart: (
    difficulty: DifficultyId,
    trials: string[],
    scenario: ScenarioId,
    seed?: string,
  ) => void;
  onStartDaily?: () => void;
  onResume?: () => void;
  resumableSummary?: RunSaveSummary | null;
  runSaveIssue?: RunSaveCompatibilityIssue | null;
  onDiscardRunSave?: () => void;
  onOpenReplays?: () => void;
  onOpenMetaShop?: () => void;
  /** 研修方針（デッキカスタム。RI-34⁗）。 */
  onOpenDeckPolicy?: () => void;
  /** カードコレクション（図鑑。RI-65 / SPEC 7.3）。 */
  onOpenCardCollection?: () => void;
  onOpenAchievements?: () => void;
  /** サウンドミュート切替（RI-59）。 */
  onToggleSoundMuted?: () => void;
  onOpenHelp?: () => void;
  /** 開始レシピ読み込み成功時に研修方針を復元する（RI-127）。 */
  onApplyPreferred?: (preferredCardIds: readonly string[]) => void;
}

export function TitleScreen({
  seed: propsSeed,
  meta,
  onStart,
  onStartDaily,
  onResume,
  resumableSummary = null,
  runSaveIssue = null,
  onDiscardRunSave,
  onOpenReplays,
  onOpenMetaShop,
  onOpenDeckPolicy,
  onOpenCardCollection,
  onOpenAchievements,
  onToggleSoundMuted,
  onOpenHelp,
  onApplyPreferred,
}: TitleScreenProps) {
  const firstUnlocked = DIFFICULTY_ORDER.find((d) => meta.unlockedDifficulties.includes(d));
  const [difficulty, setDifficulty] = useState<DifficultyId>(firstUnlocked ?? 'normal');
  const [trials, setTrials] = useState<string[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>(DEFAULT_SCENARIO);
  const [recipeSeed, setRecipeSeed] = useState<string | null>(null);
  const [recipeText, setRecipeText] = useState('');
  const [recipeStatus, setRecipeStatus] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });
  const recipeFileRef = useRef<HTMLInputElement>(null);
  const seed = recipeSeed ?? propsSeed;
  const selectedScenario = getScenario(scenario);
  const today = utcDateStr();
  const dailyRecord = getDailyRecord(meta, today);
  const selectedDifficulty = DIFFICULTY_DEFS[difficulty];
  const scoreMultiplier = trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);

  const toggleTrial = (id: string) =>
    setTrials((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const currentRecipeText = () =>
    serializeStartRecipe({
      seed,
      difficulty,
      trials,
      scenario,
      preferredCardIds: meta.preferredCardIds,
    });

  const exportRecipe = (): string => {
    const text = currentRecipeText();
    setRecipeText(text);
    setRecipeStatus({ kind: 'ok', message: '現在の開始条件を書き出しました。' });
    return text;
  };

  const downloadRecipe = () => {
    const text = exportRecipe();
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'devops-tycoon-start-recipe.json';
    link.click();
    URL.revokeObjectURL(url);
  };

  const applyRecipeText = (raw: string) => {
    const loaded = loadStartRecipe(raw, meta);
    if (!loaded.ok) {
      setRecipeStatus({ kind: 'error', message: loaded.message });
      return;
    }
    setDifficulty(loaded.recipe.difficulty);
    setTrials([...loaded.recipe.trials]);
    setScenario(loaded.recipe.scenario);
    setRecipeSeed(loaded.recipe.seed);
    setRecipeText(raw);
    onApplyPreferred?.(loaded.recipe.preferredCardIds);
    setRecipeStatus({ kind: 'ok', message: '開始条件を読み込みました。' });
  };

  const onRecipeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((raw) => {
      setRecipeText(raw);
      applyRecipeText(raw);
    });
  };

  const dailyStatus = dailyRecord
    ? `今日のベスト ${dailyRecord.bestScore} pt${dailyRecord.rewardClaimed ? ' / 報酬受領済み' : ' / 報酬未受領'}`
    : 'まだ今日の記録はありません';

  return (
    <div className="title-screen title-command" data-testid="title">
      <div className="title-world" aria-hidden="true">
        <img
          className="title-world-backdrop"
          src={publicUrl('assets/title-arena-backdrop.svg')}
          alt=""
        />
        <img
          className="title-world-platform"
          src={publicUrl('assets/title-command-platform.svg')}
          alt=""
        />
        <img className="title-world-core" src={publicUrl('assets/title-ai-core.svg')} alt="" />
        <div className="title-scanlines" />
        <div className="title-orbit title-orbit-a" />
        <div className="title-orbit title-orbit-b" />
      </div>

      <header className="title-topbar">
        <div className="title-brand">
          <span className="title-brand-mark">
            D<span>O</span>
          </span>
          <span>
            <b>DevOps Tycoon</b>
            <small>AI時代の開発組織シミュレーター</small>
          </span>
        </div>
        <div className="title-season">
          <small>基本単位</small>
          <b>1ラン = 1〜複数四半期</b>
        </div>
        <div className="title-career">
          <span>
            <small>メタ進行</small>
            <b>{meta.points} pt</b>
          </span>
          <span>
            <small>自己ベスト</small>
            <b>{meta.bestScore} pt</b>
          </span>
        </div>
      </header>

      <div className="title-content">
        <header className="title-head">
          <p className="title-eyebrow">
            <span /> ラン開始 — 組織と難易度を選ぶ
          </p>
          <h1 className="title-logo">
            DevOps Tycoon
            <br />
            <em>制約の中で、AIを活かせ。</em>
          </h1>
          <p className="title-sub">
            レビュー渋滞、技術的負債、士気、そして AI の効きどころ。
            <br />
            四半期を重ねて開発組織を立て直すシミュレーション。
          </p>
          <div className="title-hero-badges" aria-label="ゲームの特徴">
            <span>PixiJS / WebGL</span>
            <span>組織盤面 × カード戦略</span>
            <span>AI ブースト演出</span>
          </div>
          <div className="title-meta">
            <span className="pill" data-testid="seed">
              seed <b>{seed}</b>
            </span>
            <span className="pill">
              難易度 <b>{DIFFICULTY_TAG[difficulty]}</b>
            </span>
            <span className="pill">
              試練 <b>{trials.length}</b>
            </span>
          </div>
        </header>

        <main className="title-deck">
          <div className="title-deck-head">
            <div>
              <span className="title-step">01</span>
              <p>
                <b>難易度（組織の状態）</b>
                <small>開始する組織の成熟度を選ぶ</small>
              </p>
            </div>
            <span className="title-ready">
              <i /> 準備完了
            </span>
          </div>

          <section className="title-section title-difficulty-section">
            <h2 className="title-section-label">難易度</h2>
            <div className="difficulty-grid">
              {DIFFICULTY_ORDER.map((id) => {
                const def = DIFFICULTY_DEFS[id];
                const unlocked = meta.unlockedDifficulties.includes(id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`difficulty-card${difficulty === id ? ' selected' : ''}`}
                    data-testid={`difficulty-${id}`}
                    disabled={!unlocked}
                    onClick={() => setDifficulty(id)}
                  >
                    <span className="difficulty-kicker">
                      <b>{DIFFICULTY_TAG[id]}</b>
                      <i>{unlocked ? '選択可' : '未解放'}</i>
                    </span>
                    <span className="difficulty-name">{def.label}</span>
                    <span className="difficulty-desc">
                      {unlocked ? def.description : '🔒 未解放（下位難易度をクリアで解放）'}
                    </span>
                    <span className="difficulty-action">
                      {unlocked ? 'この組織で始める →' : '条件未達'}
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          <section className="title-section title-trial-section">
            <div className="title-section-copy">
              <span className="title-step">02</span>
              <p>
                <b>試練（ランモディファイア）</b>
                <small>任意。スコア倍率と引き換えに難度を上げる</small>
              </p>
            </div>
            <div className="trial-row">
              {TRIAL_DEFS.map((trial) => (
                <button
                  type="button"
                  key={trial.id}
                  className={`trial-chip${trials.includes(trial.id) ? ' on' : ''}`}
                  data-testid={`trial-${trial.id}`}
                  onClick={() => toggleTrial(trial.id)}
                  title={trial.description}
                >
                  <i>{trials.includes(trial.id) ? '×' : '+'}</i>
                  {trial.label}
                  <small>×{trial.scoreMul.toFixed(2)}</small>
                </button>
              ))}
            </div>
          </section>

          <section className="title-section title-scenario-section">
            <div className="title-section-copy">
              <span className="title-step">03</span>
              <p>
                <b>導入ツール（シナリオ）</b>
                <small>
                  任意。開始時の組織値と、ラン中の速度・レビュー・手戻り係数を変える。初期デッキには入らない
                </small>
              </p>
            </div>
            <div className="trial-row" data-testid="scenario-row">
              {SCENARIO_ORDER.map((id) => {
                const def = getScenario(id);
                return (
                  <button
                    type="button"
                    key={id}
                    className={`trial-chip${scenario === id ? ' on' : ''}`}
                    data-testid={`scenario-${id}`}
                    onClick={() => setScenario(id)}
                    title={def.description}
                  >
                    {def.label}
                  </button>
                );
              })}
            </div>
          </section>

          <section className="title-section title-recipe-section" data-testid="start-recipe">
            <div className="title-section-copy">
              <span className="title-step">04</span>
              <p>
                <b>開始レシピ（共有）</b>
                <small>難易度・試練・シナリオ・研修方針・seed をローカルで受け渡す</small>
              </p>
            </div>
            <div className="title-recipe-body">
              <textarea
                className="title-recipe-text"
                data-testid="start-recipe-text"
                value={recipeText}
                onChange={(event) => setRecipeText(event.target.value)}
                placeholder="書き出した JSON を貼り付けるか、ファイルから読み込む"
                spellCheck={false}
                rows={6}
              />
              <div className="title-recipe-actions">
                <button
                  type="button"
                  data-testid="start-recipe-export"
                  onClick={() => exportRecipe()}
                >
                  書き出す
                </button>
                <button type="button" data-testid="start-recipe-download" onClick={downloadRecipe}>
                  ファイルで保存
                </button>
                <button
                  type="button"
                  data-testid="start-recipe-apply"
                  onClick={() => applyRecipeText(recipeText)}
                >
                  読み込む
                </button>
                <button
                  type="button"
                  data-testid="start-recipe-file-button"
                  onClick={() => recipeFileRef.current?.click()}
                >
                  ファイルを開く
                </button>
                <input
                  ref={recipeFileRef}
                  type="file"
                  accept="application/json,.json"
                  hidden
                  data-testid="start-recipe-file"
                  onChange={onRecipeFile}
                />
              </div>
              {recipeStatus.message ? (
                <p
                  className={`title-recipe-status${recipeStatus.kind === 'error' ? ' error' : ''}`}
                  data-testid="start-recipe-status"
                >
                  {recipeStatus.message}
                </p>
              ) : null}
            </div>
          </section>

          {runSaveIssue && resumableSummary && onDiscardRunSave ? (
            <section
              className="title-resume title-resume-incompatible"
              data-testid="incompatible-run-save"
            >
              <div className="title-resume-copy">
                <span>再開できないセーブ</span>
                <b>
                  {DIFFICULTY_TAG[resumableSummary.difficulty]} / Q{resumableSummary.quarterNumber}{' '}
                  {PHASE_LABEL[resumableSummary.phase]}
                </b>
                <small>
                  seed: {resumableSummary.seed} · スプリント {resumableSummary.sprintsPlayed} 完了
                  {resumableSummary.runKind === 'daily' && resumableSummary.dailyDate
                    ? ` · デイリー ${resumableSummary.dailyDate}`
                    : ''}
                </small>
                <p className="title-resume-issue" data-testid="run-save-issue">
                  {runSaveIssue.kind === 'ruleset-unknown'
                    ? 'ルールセット情報がない旧セーブのため、現在のゲームでは再開できません。'
                    : '保存時と現在のルールセットが一致しないため、このセーブは再開できません。'}
                </p>
                <div className="title-resume-rulesets">
                  <small
                    title={
                      runSaveIssue.savedRuleset
                        ? `保存時: v${runSaveIssue.savedRuleset.version} / ${runSaveIssue.savedRuleset.fingerprint}`
                        : '保存時のルールセット情報なし'
                    }
                  >
                    保存時:{' '}
                    {runSaveIssue.savedRuleset ? formatRuleset(runSaveIssue.savedRuleset) : '不明'}
                  </small>
                  <small
                    title={`現在: v${runSaveIssue.currentRuleset.version} / ${runSaveIssue.currentRuleset.fingerprint}`}
                  >
                    現在: {formatRuleset(runSaveIssue.currentRuleset)}
                  </small>
                </div>
              </div>
              <button
                type="button"
                className="title-resume-btn title-resume-discard"
                data-testid="discard-run-save"
                onClick={onDiscardRunSave}
              >
                このセーブを破棄
              </button>
            </section>
          ) : null}

          {!runSaveIssue && resumableSummary && onResume ? (
            <section className="title-resume" data-testid="resume-run-section">
              <div className="title-resume-copy">
                <span>中断中のラン</span>
                <b>
                  {DIFFICULTY_TAG[resumableSummary.difficulty]} / Q{resumableSummary.quarterNumber}{' '}
                  {PHASE_LABEL[resumableSummary.phase]}
                </b>
                <small>
                  スプリント {resumableSummary.sprintsPlayed} 完了
                  {resumableSummary.runKind === 'daily' && resumableSummary.dailyDate
                    ? ` · デイリー ${resumableSummary.dailyDate}`
                    : ''}
                </small>
              </div>
              <button
                type="button"
                className="title-resume-btn"
                data-testid="resume-run"
                onClick={onResume}
              >
                続きから再開 →
              </button>
            </section>
          ) : null}

          {onStartDaily ? (
            <section className="title-launch-row" data-testid="daily-run-section">
              <div className="title-daily">
                <span>デイリーラン</span>
                <b>全員同じシードで競う</b>
                <small>
                  UTC {today}・{dailyStatus}
                </small>
                <button type="button" data-testid="start-daily-run" onClick={onStartDaily}>
                  本日のデイリーを始める →
                </button>
              </div>
              <div className="title-mission">
                <small>今回の設定</small>
                <b>
                  {DIFFICULTY_TAG[difficulty]} / 試練 {trials.length}
                  {scenario !== DEFAULT_SCENARIO ? ` / ${selectedScenario.label}` : ''}
                </b>
                <span>
                  最終倍率 <strong>×{scoreMultiplier.toFixed(2)}</strong>
                </span>
              </div>
              <button
                type="button"
                className="title-launch"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials, scenario, seed)}
              >
                <span>
                  <small>ラン開始</small>
                  四半期を始める
                </span>
                <i>→</i>
              </button>
            </section>
          ) : (
            <div className="title-actions">
              <button
                type="button"
                className="btn btn-primary btn-lg"
                data-testid="start-run"
                onClick={() => onStart(difficulty, trials, scenario, seed)}
              >
                四半期を始める →
              </button>
            </div>
          )}
        </main>

        {meta.achievements.length > 0 && (
          <section className="title-achievements">
            <span>実績</span>
            {meta.achievements.map((achievement) => (
              <b key={achievement}>🏅 {ACHIEVEMENT_LABEL[achievement] ?? achievement}</b>
            ))}
          </section>
        )}

        <footer className="title-footer">
          <span>{selectedDifficulty.label}</span>
          <nav>
            {onToggleSoundMuted && (
              <button
                type="button"
                data-testid="sound-mute"
                aria-pressed={meta.soundMuted}
                onClick={onToggleSoundMuted}
              >
                {meta.soundMuted ? 'ミュート中' : '音あり'}
              </button>
            )}
            {onOpenHelp && (
              <button type="button" data-testid="open-help" onClick={onOpenHelp}>
                遊び方
              </button>
            )}
            {onOpenReplays && (
              <button type="button" data-testid="open-replays" onClick={onOpenReplays}>
                リプレイ
              </button>
            )}
            {onOpenMetaShop && (
              <button type="button" data-testid="open-meta-shop" onClick={onOpenMetaShop}>
                研修ツール解禁（メタショップ）
              </button>
            )}
            {onOpenDeckPolicy && (
              <button type="button" data-testid="open-deck-policy" onClick={onOpenDeckPolicy}>
                研修方針
                {meta.preferredCardIds.length > 0 ? `（${meta.preferredCardIds.length}）` : ''}
              </button>
            )}
            {onOpenCardCollection && (
              <button
                type="button"
                data-testid="open-card-collection"
                onClick={onOpenCardCollection}
              >
                カードコレクション
              </button>
            )}
            {onOpenAchievements && (
              <button type="button" data-testid="open-achievements" onClick={onOpenAchievements}>
                実績コレクション
              </button>
            )}
          </nav>
        </footer>
      </div>
    </div>
  );
}
