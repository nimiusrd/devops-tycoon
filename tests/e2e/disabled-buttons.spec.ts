import { expect, test } from './fixtures';

for (const viewport of [
  { width: 320, height: 568 },
  { width: 1280, height: 800 },
]) {
  test(`${viewport.width}px: 無効ボタンも文字を読め、有効ボタンと区別できる`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize(viewport);
    await page.goto('/?seed=disabled-button-contrast&tutorial=off');
    const disabled = page.getByTestId('run-save-download');
    const enabled = page.getByTestId('run-save-file-button');
    await expect(disabled).toBeDisabled();
    await expect(enabled).toBeEnabled();
    await disabled.scrollIntoViewIfNeeded();
    const appearance = await disabled.evaluate((element) => {
      const style = getComputedStyle(element);
      const luminance = (color: string) => {
        const channels = color
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const channel = value / 255;
            return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const foreground = luminance(style.color);
      const surface = luminance(style.backgroundColor);
      return {
        opacity: style.opacity,
        backgroundImage: style.backgroundImage,
        contrast: (Math.max(foreground, surface) + 0.05) / (Math.min(foreground, surface) + 0.05),
        borderStyle: style.borderStyle,
      };
    });
    expect(appearance.opacity).toBe('1');
    expect(appearance.backgroundImage).toBe('none');
    expect(appearance.contrast).toBeGreaterThanOrEqual(4.5);
    expect(appearance.borderStyle).not.toBe(
      await enabled.evaluate((element) => getComputedStyle(element).borderStyle),
    );
    await page.screenshot({ path: testInfo.outputPath('読める無効ボタン.png'), fullPage: true });
  });
}
