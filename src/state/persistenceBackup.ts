/**
 * 保存失敗時に、途中セーブと完走リプレイを一つのファイルへまとめる。
 * ブラウザが連続ダウンロードを止めても、一回の保存で全部残す。
 */
export const PERSISTENCE_BACKUP_KIND = 'devops-tycoon-persistence-backup';
export const PERSISTENCE_BACKUP_VERSION = 1;
/** 途中セーブとリプレイを一度に戻したとき、どちらの取り込み口でも同じ案内にする。 */
export const PERSISTENCE_BACKUP_RESTORED_MESSAGE =
  '途中セーブとリプレイを読み込みました。再開できます。';

export interface PersistenceBackupFile {
  kind: typeof PERSISTENCE_BACKUP_KIND;
  version: typeof PERSISTENCE_BACKUP_VERSION;
  runSave: string | null;
  replays: string[];
}

export function serializePersistenceBackup(input: {
  runSave: string | null;
  replays: readonly string[];
}): string {
  const file: PersistenceBackupFile = {
    kind: PERSISTENCE_BACKUP_KIND,
    version: PERSISTENCE_BACKUP_VERSION,
    runSave: input.runSave,
    replays: [...input.replays],
  };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** まとめファイルなら中身を返す。単体のセーブやリプレイは null。 */
export function readPersistenceBackup(raw: string): PersistenceBackupFile | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const record = parsed as Record<string, unknown>;
  if (record.kind !== PERSISTENCE_BACKUP_KIND || record.version !== PERSISTENCE_BACKUP_VERSION) {
    return null;
  }
  if (!(record.runSave === null || typeof record.runSave === 'string')) return null;
  if (!Array.isArray(record.replays) || record.replays.some((item) => typeof item !== 'string')) {
    return null;
  }
  return {
    kind: PERSISTENCE_BACKUP_KIND,
    version: PERSISTENCE_BACKUP_VERSION,
    runSave: record.runSave,
    replays: [...record.replays],
  };
}
