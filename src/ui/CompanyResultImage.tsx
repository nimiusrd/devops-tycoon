import { useEffect, useRef, useState } from 'react';
import type { CompanyResult } from '../render/companyResultView';
import { downloadBlobFile } from './downloadTextFile';
import { generateCompanyResultPng } from './companyResultPng';

export function CompanyResultImage({ result }: { result: CompanyResult }) {
  const [preview, setPreview] = useState<{ url: string; blob: Blob } | null>(null);
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error' | 'saveError'>(
    'idle',
  );
  const generation = useRef(0);
  const busy = useRef(false);
  useEffect(
    () => () => {
      generation.current++;
    },
    [],
  );
  useEffect(
    () => () => {
      if (preview) URL.revokeObjectURL(preview.url);
    },
    [preview],
  );

  const generate = async () => {
    if (busy.current) return;
    busy.current = true;
    const request = ++generation.current;
    setStatus('loading');
    try {
      const blob = await generateCompanyResultPng(result);
      if (request !== generation.current) return;
      setPreview({ blob, url: URL.createObjectURL(blob) });
      setStatus('ready');
    } catch {
      if (request === generation.current) setStatus('error');
    } finally {
      busy.current = false;
    }
  };
  return (
    <section className="result-company-image" aria-label="会社の結果画像">
      <p className="result-section-label">会社の結果画像</p>
      <p>成果・決着時の消耗・主要カード3枚を確認して、PNGを保存できます。</p>
      <button
        type="button"
        className="btn btn-secondary"
        disabled={status === 'loading'}
        onClick={() => void generate()}
      >
        {status === 'loading'
          ? '画像を生成中…'
          : status === 'error'
            ? '画像生成を再試行'
            : '結果画像をプレビュー'}
      </button>
      <p aria-live="polite">
        {status === 'error'
          ? '画像を生成できませんでした。結果は保持されています。再試行できます。'
          : status === 'saveError'
            ? 'PNGを保存できませんでした。もう一度保存してください。'
            : status === 'ready'
              ? '画像を生成しました。内容を確認してPNGを保存できます。'
              : null}
      </p>
      {preview && (
        <>
          <img
            className="company-result-preview"
            src={preview.url}
            alt={`${result.outcome}。累計出荷 ${result.delivered} pt。最大の消耗は${result.cost.label}、残り ${result.cost.remaining} / 100。主要カード: ${result.cards.map((c) => `${c.name} Lv.${c.level}`).join('、') || 'なし'}`}
          />
          <button
            type="button"
            className="btn btn-secondary"
            disabled={status === 'loading'}
            onClick={() => {
              setStatus(
                downloadBlobFile('devops-tycoon-company-result.png', preview.blob)
                  ? 'ready'
                  : 'saveError',
              );
            }}
          >
            PNGを保存
          </button>
        </>
      )}
    </section>
  );
}
