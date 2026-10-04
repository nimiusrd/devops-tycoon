import { isCompanyResult, type CompanyResult } from '../render/companyResultView';
import { VISUAL_TOKENS } from '../render/visualTokens';

/** 固定キャンバス内で全文を折り返し、長文の場合は領域に収まる文字サイズにする。 */
export function fitImageText(
  text: string,
  width: number,
  height: number,
  initialSize: number,
  measure: (text: string, size: number) => number,
): { lines: string[]; size: number } {
  // 改行・タブはスペースに統一。日本語はコードポイント単位で折り返す。
  const characters = Array.from(text.replace(/\s/gu, ' '));
  for (let size = initialSize; size > 0; size /= 1.1) {
    const lines: string[] = [];
    let line = '';
    for (const char of characters) {
      if (line && measure(line + char, size) > width) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    lines.push(line);
    if (lines.length * size * 1.4 <= height && lines.every((l) => measure(l, size) <= width)) {
      return { lines, size };
    }
  }
  throw new Error('文字を配置できませんでした。');
}

export async function generateCompanyResultPng(result: CompanyResult): Promise<Blob> {
  if (!isCompanyResult(result)) throw new Error('画像の表示値が不正です。');
  await document.fonts.ready;
  const canvas = document.createElement('canvas');
  // この画像だけの出力座標。盤面やDOMのレイアウトとは共有しない。
  canvas.width = 1200;
  canvas.height = 900;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('画像を描画できませんでした。');
  const colors = VISUAL_TOKENS.colors;
  ctx.fillStyle = colors.panel;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = result.won ? colors.mint : colors.coral;
  ctx.fillRect(0, 0, canvas.width, 12);
  const font = (size: number) => `600 ${size}px "Noto Sans JP", "Noto Sans CJK JP", sans-serif`;
  const draw = (
    text: string,
    y: number,
    height: number,
    size = 36,
    color: string = colors.text,
  ) => {
    const fitted = fitImageText(text, 1080, height, size, (line, textSize) => {
      ctx.font = font(textSize);
      return ctx.measureText(line).width;
    });
    ctx.font = font(fitted.size);
    ctx.fillStyle = color;
    ctx.textBaseline = 'top';
    fitted.lines.forEach((line, i) => ctx.fillText(line, 60, y + i * fitted.size * 1.4));
  };
  draw('DevOps Tycoon / 会社の結果', 44, 50, 30, colors.cream);
  draw(result.outcome, 110, 130, 58, result.won ? colors.mint : colors.coral);
  draw(`累計出荷  ${result.delivered} pt`, 262, 75, 48);
  draw(
    `最大の消耗（決着時）  ${result.cost.label} 残り ${result.cost.remaining} / 100`,
    360,
    75,
    32,
    colors.sun,
  );
  draw('主要カード / 強化レベル順・同点はデッキ順', 470, 55, 28, colors.lav);
  for (let i = 0; i < 3; i++) {
    const card = result.cards[i];
    draw(
      card ? `${i + 1}. ${card.name} / Lv.${card.level}` : `${i + 1}. カードなし`,
      540 + i * 90,
      80,
      34,
    );
  }
  draw('消耗は士気とシニア体力を比較。画像は端末内で生成。', 837, 40, 24, colors.textDim);
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('PNGを生成できませんでした。'))),
      'image/png',
    );
  });
}
