/**
 * 部門ゾーンの定義（SPEC 第4.8）。
 *
 * 全社マップを縦ストライプで色分けする事業部/部門。データ駆動にして、
 * 追加・改名・色変更をコード変更（ロジック）なしで行えるようにする（architecture §4.3）。
 */
import type { DepartmentDef } from '../sim/orgscale/types';

/** 全社を構成する部門（旧モック org-screen の 3 部門構成由来）。 */
export const DEPARTMENT_DEFS: readonly DepartmentDef[] = [
  { id: 'product', name: 'プロダクト事業部', color: '#6b4a9e', teamCount: 4 },
  { id: 'platform', name: '基盤・プラットフォーム部', color: '#2f6f7a', teamCount: 3 },
  { id: 'newbiz', name: '新規事業部', color: '#9e5a4a', teamCount: 3 },
];

