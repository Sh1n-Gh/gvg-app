require('dotenv').config({ quiet: true });
const path = require('node:path');
const { createDb } = require('../db');
const { migrateCredentials } = require('../auth/migrate');
async function main() {
  const db = createDb(process.env.DB_PATH || path.join(__dirname, '../db/gvg.db'));
  try {
    const counts = await migrateCredentials(db, { backupPath: process.env.AUTH_MIGRATION_BACKUP_PATH });
    console.log(JSON.stringify(counts));
  } finally { db.close(); }
}
main().catch(() => {
  console.error('AUTH_MIGRATION: failed; check runtime, backup destination, bootstrap configuration and legacy data offline. No credentials changed on failure.');
  process.exitCode = 1;
});
