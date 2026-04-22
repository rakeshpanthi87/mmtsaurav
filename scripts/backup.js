/**
 * scripts/backup.js
 *
 * SQLite hot-backup using better-sqlite3's built-in .backup() API.
 * Safe to run while the server is live — no lock required.
 *
 * Usage:
 *   node scripts/backup.js            (manual run)
 *   npm run backup                    (via package.json script)
 *
 * Called automatically by server.js cron at 2:00 AM daily.
 * Keeps the last 7 daily backups; older ones are deleted.
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const path     = require('path');
const fs       = require('fs');

const DB_SRC     = path.resolve(process.env.DB_PATH || './database/mmt.db');
const BACKUP_DIR = path.resolve('./backups');
const KEEP_DAYS  = 7;

async function runBackup() {
  if (!fs.existsSync(DB_SRC)) {
    console.error('[Backup] Source DB not found:', DB_SRC);
    process.exit(1);
  }

  fs.mkdirSync(BACKUP_DIR, { recursive: true });

  const stamp    = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const destFile = path.join(BACKUP_DIR, `mmt_${stamp}.db`);

  console.log(`[Backup] ${new Date().toLocaleTimeString()} — backing up to ${destFile}`);

  const src = new Database(DB_SRC, { readonly: true });
  await src.backup(destFile);
  src.close();

  const stat = fs.statSync(destFile);
  console.log(`[Backup] Done — ${(stat.size / 1024 / 1024).toFixed(2)} MB`);

  pruneOldBackups();
}

function pruneOldBackups() {
  const cutoff = Date.now() - KEEP_DAYS * 24 * 60 * 60 * 1000;
  const files  = fs.readdirSync(BACKUP_DIR)
    .filter(f => f.startsWith('mmt_') && f.endsWith('.db'))
    .map(f => ({ name: f, mtime: fs.statSync(path.join(BACKUP_DIR, f)).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  const toDelete = files.filter(f => f.mtime < cutoff);
  for (const f of toDelete) {
    fs.unlinkSync(path.join(BACKUP_DIR, f.name));
    console.log(`[Backup] Pruned old backup: ${f.name}`);
  }

  console.log(`[Backup] ${files.length - toDelete.length} backup(s) retained`);
}

runBackup().catch(e => {
  console.error('[Backup] FAILED:', e.message);
  process.exit(1);
});
