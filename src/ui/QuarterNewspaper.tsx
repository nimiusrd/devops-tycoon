import { quarterNewspaperView } from '../render/quarterNewspaperView';
import type { QuarterNewspaperInput } from '../render/quarterNewspaperView';
import './QuarterNewspaper.css';

export function QuarterNewspaper(props: QuarterNewspaperInput) {
  const view = quarterNewspaperView(props);
  return (
    <details className="result-details quarter-newspaper" data-testid="quarter-newspaper">
      <summary>社内新聞 · Q{view.quarterNumber}</summary>
      <p className="quarter-newspaper-note">
        この期に保存された出荷と士気の記録です。達否は各目標の判定で、投資・採用の効果や因果は示しません。
      </p>
      <ol>
        {view.articles.map((article) => (
          <li key={article.id} data-testid="quarter-newspaper-article" data-article={article.id}>
            <h3>{article.headline}</h3>
            <p className="quarter-newspaper-note">根拠: {article.basis}</p>
          </li>
        ))}
      </ol>
    </details>
  );
}
