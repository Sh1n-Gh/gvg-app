require('dotenv').config({ quiet: true });
const path = require('node:path');
const fs = require('node:fs');
const Database = require('better-sqlite3');
const { preflight, migrate, migrateProduction } = require('../db/migrations');

async function main() {
  const args = process.argv.slice(2);
  if (args.some(a => !['--dry-run', '--init'].includes(a))) throw new Error('MIGRATION: unknown option');
  if (!process.env.DB_PATH || !path.isAbsolute(process.env.DB_PATH)) throw new Error('MIGRATION: explicit absolute DB_PATH required');
  const dry = args.includes('--dry-run');
  const exists = fs.existsSync(process.env.DB_PATH);
  if (!exists && !args.includes('--init')) throw new Error('MIGRATION: database missing; use --init only for a new database');
  // Missing-file preflight uses memory and never creates the target file.
  const db = new Database(dry && !exists ? ':memory:' : process.env.DB_PATH,
    { readonly: dry && exists, fileMustExist: exists });
  try {
    if (dry) console.log(JSON.stringify(preflight(db)));
    else if (process.env.NODE_ENV === 'production') {
      const hookPath = process.env.MIGRATION_BACKUP_HOOK;
      if (hookPath && !path.isAbsolute(hookPath)) throw new Error('MIGRATION: backup hook path must be absolute');
      console.log(JSON.stringify(await migrateProduction(db, {
        beforeMigrate: hookPath ? require(hookPath).beforeMigrate : undefined,
      })));
    } else console.log(JSON.stringify(migrate(db)));
  } finally { db.close(); }
}
main().catch(error => {
  console.error(error.message.startsWith('MIGRATION:') ? error.message : 'MIGRATION: failed; inspect database, manifest and backup hook offline');
  process.exitCode = 1;
});
