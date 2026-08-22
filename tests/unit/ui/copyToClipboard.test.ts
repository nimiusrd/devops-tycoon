import { afterEach, describe, expect, it, vi } from 'vitest';
import { copyToClipboard } from '../../../src/ui/copyToClipboard';

describe('copyToClipboard', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('利用可能なClipboard APIを優先する', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    vi.stubGlobal('navigator', { clipboard: { writeText } });

    await expect(copyToClipboard('diagnostic-json')).resolves.toBe(true);
    expect(writeText).toHaveBeenCalledWith('diagnostic-json');
  });

  it('Clipboard APIがない場合は手動コピー用のtextareaへフォールバックする', async () => {
    const textarea = {
      value: '',
      style: {},
      setAttribute: vi.fn(),
      select: vi.fn(),
      remove: vi.fn(),
    };
    const documentStub = {
      body: { appendChild: vi.fn() },
      createElement: vi.fn(() => textarea),
      execCommand: vi.fn(() => true),
    };
    vi.stubGlobal('navigator', {});
    vi.stubGlobal('document', documentStub);

    await expect(copyToClipboard('fallback-json')).resolves.toBe(true);
    expect(textarea.value).toBe('fallback-json');
    expect(textarea.select).toHaveBeenCalledOnce();
    expect(documentStub.execCommand).toHaveBeenCalledWith('copy');
    expect(textarea.remove).toHaveBeenCalledOnce();
  });
});
