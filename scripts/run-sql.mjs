// Spustí SQL soubor proti databázi Supabase: node scripts/run-sql.mjs supabase/migration.sql
// Připojení bere z proměnné DATABASE_URL (viz .env).
import fs from 'node:fs';
import pg from 'pg';

const url = process.env.DATABASE_URL;
if (!url) { console.error('Chybí DATABASE_URL'); process.exit(1); }
const sql = fs.readFileSync(process.argv[2], 'utf8');
const client = new pg.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
await client.connect();
try {
  await client.query(sql);
  console.log('OK:', process.argv[2]);
} finally {
  await client.end();
}
