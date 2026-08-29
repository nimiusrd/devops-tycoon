import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadTextFile } from '../../../src/ui/downloadTextFile';

describe('downloadTextFile', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('アンカーを document に接続してから click し、revoke は遅延する', () => {
    const click = vi.fn();
    const remove = vi.fn();
    const link = {
      href: '',
      download: '',
      rel: '',
      style: { display: '' },
      click,
      remove,
    };
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => link),
    });
    const createObjectURL = vi.fn(() => 'blob:test-recipe');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL });

    expect(downloadTextFile('devops-tycoon-start-recipe.json', '{"ok":true}\n')).toBe(true);
    expect(appendChild).toHaveBeenCalledWith(link);
    expect(click).toHaveBeenCalledOnce();
    expect(click.mock.invocationCallOrder[0]).toBeGreaterThan(
      appendChild.mock.invocationCallOrder[0]!,
    );
    expect(link.download).toBe('devops-tycoon-start-recipe.json');
    expect(link.href).toBe('blob:test-recipe');
    expect(revokeObjectURL).not.toHaveBeenCalled();
    expect(remove).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1_000);
    expect(remove).toHaveBeenCalledOnce();
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:test-recipe');
  });

  it('document.body が無い場合は保存せず false を返す', () => {
    vi.stubGlobal('document', { body: null, createElement: vi.fn() });
    const createObjectURL = vi.fn();
    vi.stubGlobal('URL', { createObjectURL, revokeObjectURL: vi.fn() });

    expect(downloadTextFile('x.json', '{}')).toBe(false);
    expect(createObjectURL).not.toHaveBeenCalled();
  });

  it('createObjectURL が失敗したら false を返し、呼び出し側がエラー表示できる', () => {
    const appendChild = vi.fn();
    vi.stubGlobal('document', {
      body: { appendChild },
      createElement: vi.fn(() => ({
        href: '',
        download: '',
        rel: '',
        style: { display: '' },
        click: vi.fn(),
        remove: vi.fn(),
      })),
    });
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => {
        throw new Error('blob blocked');
      }),
      revokeObjectURL: vi.fn(),
    });

    expect(downloadTextFile('x.json', '{}')).toBe(false);
    expect(appendChild).not.toHaveBeenCalled();
  });
});
