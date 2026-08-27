/**
 * タイトルからの「遊び方」ヘルプ（RI-60 / RI-67）。
 *
 * 世界観の制約（第2.1）に沿った現実的なトーンで、初見が最初のスプリントまで
 * 到達できる最低限の操作を説明する。描画は読むだけ（第22.2）。
 */
import { ResultOverlay } from './ResultOverlay';

export interface HowToPlayScreenProps {
  onClose: () => void;
}

const SECTIONS: readonly { title: string; body: string }[] = [
  {
    title: '1ラン = 1〜複数四半期',
    body: '難易度と試練を選んで四半期を始めます。目標未達でも継続可能なら目標を修正し、組織の状態を引き継いで次四半期へ進みます。',
  },
  {
    title: 'スプリント中の介入',
    body: '画面下の介入バーから、マネジメント集中力を使って現場へ手を入れます。緊急対応は複数炎上や延焼直前だけが本命で、余裕のある先消しはかえって高くつきます。アンドンはキューを捌く猶予、AIスロットルは新規タスクをAIなしにします。点火の抑制はリテラシーが低いときだけ、手戻りの抑制はワークフローが未熟なときだけで効きます。前提度が高く成熟しているときは工程ずれで手戻りが増えることがあります。ペアレビューは詰まったPRを処理しつつAI Literacyを上げ、依存度が高くてもリテラシーが低いままだと敗北するので早めに使いましょう。一部の介入は武装してから盤面へドラッグします。',
  },
  {
    title: 'シニア体力と燃え尽き',
    body: 'シニア体力はメンバー個別のスタミナとは別の抽象値です。尽きるとシニア燃え尽きで敗北します。炎上の自動鎮火は大きく削りますが、緊急対応も余裕のある先消しでは高コストでコンボが切れます。複数炎上やタイマーが短いときだけ打ち、アンドンは流入を止めてキューを捌く猶予を作り、AIスロットルは新規タスクをAIなしにします。点火の抑制はリテラシーが低いときだけ、手戻りの抑制はワークフローが未熟なときだけで効きます。前提度が高く成熟していると工程ずれで手戻りが増えることがあります。休息で体力を戻します。',
  },
  {
    title: 'レビュー渋滞を見る',
    body: 'Review レーンにタスクが溜まると渋滞メーターが上がります。枠を超える前にレビューを回し、手戻りや士気の低下を防ぎます。',
  },
  {
    title: '連携と手札',
    body: '介入を繋げると連携ゲージが溜まり、コンボが伸びます。手札のカードは集中力を消費して発動できます。無理な残業だけに頼らず、流れを作る運用を意識しましょう。',
  },
  {
    title: 'スプリントのあいだ',
    body: 'スプリント後は結果確認・カード選択・ビート判定が入ります。組織の状態を見ながら次の一手を決め、四半期の目標達成を目指します。',
  },
];

export function HowToPlayScreen({ onClose }: HowToPlayScreenProps) {
  return (
    <ResultOverlay data-testid="how-to-play" role="dialog" aria-label="遊び方">
      <div className="how-to-play-panel">
        <div className="result-overlay-body">
          <p className="result-eyebrow">HOW TO PLAY</p>
          <h2 className="draft-title">遊び方</h2>
          <p className="how-to-play-lead">
            レビュー渋滞・技術的負債・士気・AI
            の効きどころ。制約の中で開発組織を回すための基本操作です。
          </p>
          <ol className="how-to-play-list">
            {SECTIONS.map((section) => (
              <li key={section.title} className="how-to-play-item">
                <b>{section.title}</b>
                <p>{section.body}</p>
              </li>
            ))}
          </ol>
        </div>
        <button
          type="button"
          className="btn btn-primary result-overlay-close"
          data-testid="how-to-play-close"
          onClick={onClose}
        >
          閉じる
        </button>
      </div>
    </ResultOverlay>
  );
}
