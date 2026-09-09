require('dotenv').config({ quiet: true });
const { backup, restore } = require('./sqlite-backup');
async function main() {
  const [operation, ...args] = process.argv.slice(2);
  if (args.length || !['backup', 'restore'].includes(operation)) throw new Error('Use backup or restore without additional arguments');
  const result = operation === 'backup'
    ? await backup({ source: process.env.DB_PATH, directory: process.env.BACKUP_DIR, retentionDays: process.env.BACKUP_RETENTION_DAYS || 7 })
    : { ok: true, path: await restore(process.env.BACKUP_FILE, process.env.RESTORE_DB_PATH) };
  console.log(JSON.stringify(result));
}
main().catch(() => { console.error('BACKUP/RESTORE failed: check explicit paths, private directory, permissions, free space and SQLite integrity. No success receipt issued.'); process.exitCode = 1; });
