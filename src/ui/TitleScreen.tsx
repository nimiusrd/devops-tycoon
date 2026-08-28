/**
 * タイトル画面（ラン開始 / SPEC 第16章 / 第17章）。
 *
 * 難易度（解放済みのみ）と試練を選び、ランを開始する。メタ進行（解放状況・
 * 実績）も表示する。世界観の制約（第2.1）に沿った現実的なトーン。
 * レイアウトは司令室 UI の構図を使い、文言は SPEC の用語に揃える。
 * ラン開始 CTA は画面下のドックに常時出し、初見がスクロールなしで始められるようにする。
 */
import { useCallback, useEffect, useRef, useState, type ChangeEvent } from 'react';
import { createPortal } from 'react-dom';
import { DIFFICULTY_DEFS, DIFFICULTY_ORDER, TRIAL_DEFS, getTrial } from '../data/difficulties';
import { ACHIEVEMENT_LABEL, getDailyRecord, utcDateStr, type MetaState } from '../state/meta';
import { loadStartRecipe, serializeStartRecipe } from '../state/startRecipe';
import type { RunSaveCompatibilityIssue, RunSaveSummary } from '../state/runPersistence';
import type { ResumeRisk } from '../state/resumeRisk';
import type { DifficultyId } from '../sim/run/types';
import { DEFAULT_SCENARIO, SCENARIO_ORDER, getScenario } from '../sim/scenarios';
import type { ScenarioId } from '../sim/types';
import { publicUrl } from '../utils/publicUrl';
import { StartDailyConfirmDialog } from './StartDailyConfirmDialog';
import { DIFFICULTY_TAG, resumableRunDetail, resumableRunHeadline } from './runSaveSummaryCopy';
import { downloadTextFile } from './downloadTextFile';

function formatRuleset(ruleset: { version: number; fingerprint: string }): string {
  const fingerprint =
    ruleset.fingerprint.length > 12 ? `${ruleset.fingerprint.slice(0, 12)}…` : ruleset.fingerprint;
  return `v${ruleset.version} / ${fingerprint}`;
}

function ResumeRiskDialog({
  risk,
  onCancel,
  onConfirm,
}: {
  risk: ResumeRisk;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
        return;
      }
      if (event.key !== 'Tab' || !dialogRef.current) return;
      const focusable = [...dialogRef.current.querySelectorAll<HTMLElement>('button')];
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onCancel]);

  return (
    <div
      ref={dialogRef}
      className="result-overlay"
      data-testid="resume-risk-dialog"
      role="dialog"
      aria-modal="true"
      aria-labelledby="resume-risk-title"
      aria-describedby="resume-risk-body"
    >
      <div className="result-card resume-risk-card">
        <p className="result-eyebrow">RESUME WARNING</p>
        <h2 id="resume-risk-title" className="draft-title">
          {risk.headline}
        </h2>
        <p id="resume-risk-body" className="resume-risk-body">
          {risk.body}
        </p>
        <ul className="resume-risk-flags">
          {risk.flags.map((flag) => (
            <li key={flag.id}>
              <span className={`pill tone-${flag.tone}`}>{flag.chip}</span>
              {flag.id === 'seniorHp' || flag.id === 'seniorBurnout'
                ? ` シニア体力 ${risk.seniorHpPct}%`
                : null}
            </li>
          ))}
        </ul>
        <div className="result-actions">
          <button
            ref={cancelRef}
            type="button"
            className="btn btn-primary"
            data-testid="resume-risk-cancel"
            onClick={onCancel}
          >
            再開しない
          </button>
          <button
            type="button"
            className="btn btn-danger"
            data-testid="resume-risk-confirm"
            onClick={onConfirm}
          >
            それでも再開する
          </button>
        </div>
      </div>
    </div>
  );
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
  resumeRisk?: ResumeRisk | null;
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
  /** 現行の途中セーブを JSON にする（無い場合は null。RI-133）。 */
  onExportRunSave?: () => string | null;
  /** JSON から途中セーブを読み込む。 */
  onImportRunSave?: (raw: string) => Promise<{ ok: boolean; message: string }>;
}

export function TitleScreen({
  seed: propsSeed,
  meta,
  onStart,
  onStartDaily,
  onResume,
  resumableSummary = null,
  resumeRisk = null,
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
  onExportRunSave,
  onImportRunSave,
}: TitleScreenProps) {
  const firstUnlocked = DIFFICULTY_ORDER.find((d) => meta.unlockedDifficulties.includes(d));
  const [difficulty, setDifficulty] = useState<DifficultyId>(firstUnlocked ?? 'normal');
  const [trials, setTrials] = useState<string[]>([]);
  const [scenario, setScenario] = useState<ScenarioId>(DEFAULT_SCENARIO);
  const [recipeSeed, setRecipeSeed] = useState<string | null>(null);
  /** 手編集中の JSON。null なら現在の開始条件を即時直列化する（#383）。 */
  const [recipeDraft, setRecipeDraft] = useState<string | null>(null);
  const [recipeStatus, setRecipeStatus] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });
  const recipeFileRef = useRef<HTMLInputElement>(null);
  const runSaveFileRef = useRef<HTMLInputElement>(null);
  const runSaveImportGen = useRef(0);
  const [runSaveImporting, setRunSaveImporting] = useState(false);
  const [runSaveShareStatus, setRunSaveShareStatus] = useState<{
    kind: 'idle' | 'ok' | 'error';
    message: string;
  }>({ kind: 'idle', message: '' });
  const [dailyConfirmOpen, setDailyConfirmOpen] = useState(false);
  const dailyConfirmWasOpen = useRef(false);
  const startDailyButtonRef = useRef<HTMLButtonElement>(null);
  const [resumeConfirmOpen, setResumeConfirmOpen] = useState(false);
  const resumeBtnRef = useRef<HTMLButtonElement>(null);
  const seed = recipeSeed ?? propsSeed;
  const selectedScenario = getScenario(scenario);
  const today = utcDateStr();
  const dailyRecord = getDailyRecord(meta, today);
  const selectedDifficulty = DIFFICULTY_DEFS[difficulty];
  const scoreMultiplier = trials.reduce((m, id) => m * (getTrial(id)?.scoreMul ?? 1), 1);

  const toggleTrial = (id: string) =>
    setTrials((cur) => (cur.includes(id) ? cur.filter((t) => t !== id) : [...cur, id]));

  const liveRecipeText = serializeStartRecipe({
    seed,
    difficulty,
    trials,
    scenario,
    preferredCardIds: meta.preferredCardIds,
  });
  const recipeText = recipeDraft ?? liveRecipeText;

  const exportRecipe = (): string => {
    setRecipeDraft(null);
    setRecipeStatus({ kind: 'ok', message: '現在の開始条件を書き出しました。' });
    return liveRecipeText;
  };

  const downloadRecipe = () => {
    const text = liveRecipeText;
    setRecipeDraft(null);
    if (downloadTextFile('devops-tycoon-start-recipe.json', text)) {
      setRecipeStatus({ kind: 'ok', message: '開始レシピをファイルに保存しました。' });
      return;
    }
    setRecipeStatus({
      kind: 'error',
      message: '開始レシピをファイルに保存できませんでした。',
    });
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
    setRecipeDraft(null);
    onApplyPreferred?.(loaded.recipe.preferredCardIds);
    setRecipeStatus({ kind: 'ok', message: '開始条件を読み込みました。' });
  };

  const onRecipeFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    void file.text().then((raw) => {
      setRecipeDraft(raw);
      applyRecipeText(raw);
    });
  };

  const downloadRunSave = () => {
    if (!onExportRunSave) return;
    const text = onExportRunSave();
    if (!text) {
      setRunSaveShareStatus({ kind: 'error', message: '書き出せる途中セーブがありません。' });
      return;
    }
    if (downloadTextFile('devops-tycoon-run-save.json', text)) {
      setRunSaveShareStatus({ kind: 'ok', message: '途中セーブをファイルに保存しました。' });
      return;
    }
    setRunSaveShareStatus({
      kind: 'error',
      message: '途中セーブをファイルに保存できませんでした。',
    });
  };

  const onRunSaveFile = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !onImportRunSave) return;
    const requestId = ++runSaveImportGen.current;
    setRunSaveImporting(true);
    void file
      .text()
      .then(async (raw) => {
        if (requestId !== runSaveImportGen.current) return;
        const result = await onImportRunSave(raw);
        if (requestId !== runSaveImportGen.current) return;
        setRunSaveShareStatus({
          kind: result.ok ? 'ok' : 'error',
          message: result.ok ? '途中セーブを読み込みました。再開できます。' : result.message,
        });
      })
      .catch(() => {
        if (requestId !== runSaveImportGen.current) return;
        setRunSaveShareStatus({
          kind: 'error',
          message: '途中セーブが壊れているか、読み取れません。',
        });
      })
      .finally(() => {
        if (requestId !== runSaveImportGen.current) return;
        setRunSaveImporting(false);
      });
  };

  const dailyStatus = dailyRecord
    ? `今日のベスト ${dailyRecord.bestScore} pt${dailyRecord.rewardClaimed ? ' / 報酬受領済み' : ' / 報酬未受領'}`
    : 'まだ今日の記録はありません';

  const closeDailyConfirm = useCallback(() => setDailyConfirmOpen(false), []);
  const confirmStartDaily = useCallback(() => {
    setDailyConfirmOpen(false);
    onStartDaily?.();
  }, [onStartDaily]);
  const confirmResumeFromDaily = useCallback(() => {
    setDailyConfirmOpen(false);
    onResume?.();
  }, [onResume]);
  const requestStartDaily = () => {
    if (runSaveImporting) return;
    if (resumableSummary) {
      setDailyConfirmOpen(true);
      return;
    }
    onStartDaily?.();
  };

  useEffect(() => {
    if (dailyConfirmOpen) {
      dailyConfirmWasOpen.current = true;
      return;
    }
    if (!dailyConfirmWasOpen.current) return;
    dailyConfirmWasOpen.current = false;
    // ダイアログ側は useDialogOverlayLock が背面を inert にする。解除後に開いたボタンへ戻す。
    startDailyButtonRef.current?.focus();
  }, [dailyConfirmOpen]);

  const launchControls = onStartDaily ? (
    <section className="title-launch-row" data-testid="daily-run-section">
      <div className="title-daily">
        <span>デイリーラン</span>
        <b>全員同じシードで競う</b>
        <small>
          UTC {today}・{dailyStatus}
        </small>
        <button
          ref={startDailyButtonRef}
          type="button"
          data-testid="start-daily-run"
          disabled={runSaveImporting}
          aria-haspopup={resumableSummary ? 'dialog' : undefined}
          aria-expanded={resumableSummary ? dailyConfirmOpen : undefined}
          onClick={requestStartDaily}
        >
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
        disabled={runSaveImporting}
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
        disabled={runSaveImporting}
        onClick={() => onStart(difficulty, trials, scenario, seed)}
      >
        四半期を始める →
      </button>
    </div>
  );

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

      <div className="title-scroll" data-testid="title-scroll">
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
                  onChange={(event) => setRecipeDraft(event.target.value)}
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
                  <button
                    type="button"
                    data-testid="start-recipe-download"
                    onClick={downloadRecipe}
                  >
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
                    role="status"
                    aria-live="polite"
                  >
                    {recipeStatus.message}
                  </p>
                ) : null}
              </div>
            </section>

            {onExportRunSave || onImportRunSave ? (
              <section className="title-section title-recipe-section" data-testid="run-save-share">
                <div className="title-section-copy">
                  <span className="title-step">05</span>
                  <p>
                    <b>途中セーブ（共有）</b>
                    <small>中断中のランだけをローカル JSON で受け渡す。メタ進行は含まない</small>
                  </p>
                </div>
                <div className="title-recipe-body">
                  <div className="title-recipe-actions">
                    {onExportRunSave ? (
                      <button
                        type="button"
                        data-testid="run-save-download"
                        disabled={!resumableSummary || !!runSaveIssue}
                        onClick={downloadRunSave}
                      >
                        ファイルで保存
                      </button>
                    ) : null}
                    {onImportRunSave ? (
                      <>
                        <button
                          type="button"
                          data-testid="run-save-file-button"
                          disabled={runSaveImporting}
                          onClick={() => runSaveFileRef.current?.click()}
                        >
                          ファイルを開く
                        </button>
                        <input
                          ref={runSaveFileRef}
                          type="file"
                          accept="application/json,.json"
                          hidden
                          data-testid="run-save-file"
                          disabled={runSaveImporting}
                          onChange={onRunSaveFile}
                        />
                      </>
                    ) : null}
                  </div>
                  {runSaveShareStatus.message ? (
                    <p
                      className={`title-recipe-status${runSaveShareStatus.kind === 'error' ? ' error' : ''}`}
                      data-testid="run-save-share-status"
                      role="status"
                      aria-live="polite"
                    >
                      {runSaveShareStatus.message}
                    </p>
                  ) : null}
                </div>
              </section>
            ) : null}

            {runSaveIssue && resumableSummary && onDiscardRunSave ? (
              <section
                className="title-resume title-resume-incompatible"
                data-testid="incompatible-run-save"
              >
                <div className="title-resume-copy">
                  <span>再開できないセーブ</span>
                  <b>{resumableRunHeadline(resumableSummary)}</b>
                  <small>{resumableRunDetail(resumableSummary, { includeSeed: true })}</small>
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
                      {runSaveIssue.savedRuleset
                        ? formatRuleset(runSaveIssue.savedRuleset)
                        : '不明'}
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
                  disabled={runSaveImporting}
                  onClick={onDiscardRunSave}
                >
                  このセーブを破棄
                </button>
              </section>
            ) : null}

            {!runSaveIssue && resumableSummary && onResume ? (
              <section
                className={`title-resume${resumeRisk?.tone === 'danger' ? ' title-resume-risk' : ''}`}
                data-testid="resume-run-section"
              >
                <div className="title-resume-copy">
                  <span>中断中のラン</span>
                  <b>{resumableRunHeadline(resumableSummary)}</b>
                  <small>{resumableRunDetail(resumableSummary)}</small>
                  {resumeRisk ? (
                    <p className="title-resume-warning" data-testid="resume-risk-warning">
                      <span>{resumeRisk.headline}</span>
                      {resumeRisk.flags.map((flag) => (
                        <span key={flag.id} className={`pill tone-${flag.tone}`}>
                          {flag.chip}
                          {flag.id === 'seniorHp' || flag.id === 'seniorBurnout'
                            ? ` ${resumeRisk.seniorHpPct}%`
                            : ''}
                        </span>
                      ))}
                    </p>
                  ) : null}
                </div>
                <button
                  ref={resumeBtnRef}
                  type="button"
                  className="title-resume-btn"
                  data-testid="resume-run"
                  disabled={runSaveImporting}
                  onClick={() => {
                    if (resumeRisk?.requiresConfirm) {
                      setResumeConfirmOpen(true);
                      return;
                    }
                    onResume();
                  }}
                >
                  続きから再開 →
                </button>
              </section>
            ) : null}
          </main>

          {meta.achievements.length > 0 && (
            <section className="title-achievements">
              <span>実績</span>
              {meta.achievements.map((achievement) => (
                <b key={achievement}>🏅 {ACHIEVEMENT_LABEL[achievement] ?? achievement}</b>
              ))}
            </section>
          )}

          <footer className="title-footer" data-testid="title-footer">
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

      <div
        className="title-launch-dock"
        data-testid="title-launch-dock"
        role="region"
        aria-label="ラン開始"
      >
        <div className="title-launch-dock-inner">{launchControls}</div>
      </div>
      {/* overflow:hidden のタイトル面から外し、既存 overlay と同じく全面を覆う */}
      {dailyConfirmOpen && resumableSummary && onStartDaily
        ? createPortal(
            <StartDailyConfirmDialog
              summary={resumableSummary}
              canResume={!runSaveIssue && !!onResume}
              onCancel={closeDailyConfirm}
              onResume={confirmResumeFromDaily}
              onDiscardAndStart={confirmStartDaily}
            />,
            document.body,
          )
        : null}
      {resumeConfirmOpen && resumeRisk?.requiresConfirm ? (
        <ResumeRiskDialog
          risk={resumeRisk}
          onCancel={() => {
            setResumeConfirmOpen(false);
            resumeBtnRef.current?.focus();
          }}
          onConfirm={() => {
            setResumeConfirmOpen(false);
            onResume?.();
          }}
        />
      ) : null}
    </div>
  );
}
