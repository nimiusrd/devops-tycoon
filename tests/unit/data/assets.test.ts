import { describe, expect, it } from 'vitest';
import { gameAssets, getGameAsset, getGameAssetUrl } from '../../../src/data/assets';

describe('game asset catalog (RI-92)', () => {
  it('全18 SVGを一意なIDで正本カタログに保持する', () => {
    expect(gameAssets).toHaveLength(18);
    expect(new Set(gameAssets.map((asset) => asset.id)).size).toBe(gameAssets.length);
    for (const asset of gameAssets) {
      expect(asset.path).toMatch(/assets\/game\/[\w-]+\.svg$/);
      expect(asset.decision).toBe('maintain');
      expect(Array.isArray(asset.surfaces)).toBe(true);
    }
  });

  it('画面組み込み6点の利用面を明示する', () => {
    expect(getGameAsset('product-oracle').surfaces).toEqual(['board', 'org']);
    expect(getGameAsset('platform-architect').surfaces).toEqual(['board', 'org', 'dept']);
    expect(getGameAsset('qa-alchemist').surfaces).toEqual(['board', 'org', 'dept']);
    expect(getGameAsset('sre-ranger').surfaces).toEqual(['org']);
    expect(getGameAsset('incident-commander').surfaces).toEqual(['board']);
    expect(getGameAsset('release-captain').surfaces).toEqual(['board']);
  });

  it('URLアクセサーはカタログのbase-aware pathを返す', () => {
    expect(getGameAssetUrl('platform-architect')).toContain('assets/game/platform-architect.svg');
  });
});
