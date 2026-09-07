import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { createHash } from 'node:crypto';

const migrationsDir = resolve(process.env.MIGRATIONS_DIR ?? 'apps/backend/migrations');
const host = process.env.DATABASE_HOST ?? 'localhost';
const port = Number(process.env.DATABASE_PORT ?? 5432);
const database = process.env.DATABASE_NAME;
const user = process.env.DATABASE_USER;
const password = process.env.DATABASE_PASSWORD;
const ssl = String(process.env.DATABASE_SSL ?? 'false').toLowerCase() === 'true';

if (!database || !user || !password) {
  throw new Error('DATABASE_NAME, DATABASE_USER and DATABASE_PASSWORD are required.');
}

const client = new Client({
  host,
  port,
  database,
  user,
  password,
  ssl: ssl ? { rejectUnauthorized: false } : false,
});

try {
  await client.connect();
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      filename TEXT PRIMARY KEY,
      checksum TEXT,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await client.query("ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum TEXT");
  await client.query("SELECT pg_advisory_lock(hashtext('majalis-elm:schema-migrations'))");

  const files = (await readdir(migrationsDir))
    .filter((file) => /^\d+_.+\.sql$/.test(file))
    .sort();

  // Ordering safety: every migration in this project uses a 3-digit
  // zero-padded numeric prefix (000, 001, ... 043), which is what makes the
  // plain string .sort() above equivalent to numeric order. That's a naming
  // *convention*, not something enforced anywhere — a future file added
  // without zero-padding (e.g. "44_x.sql" next to "005_y.sql") would sort
  // as a string ("44_x.sql" < "005_y.sql") and silently apply out of the
  // intended order. Fail loudly instead of trusting the convention forever.
  const versions = files.map((file) => {
    const match = /^(\d+)_/.exec(file);
    return match ? { file, digits: match[1], version: Number(match[1]) } : null;
  });

  const malformed = versions.find(
    (entry) => entry === null || entry.digits.length !== 3,
  );
  if (malformed) {
    const label = malformed ? malformed.file : '(unknown)';
    throw new Error(
      `Invalid migration filename "${label}": expected a 3-digit zero-padded numeric ` +
        'prefix (e.g. "044_add_thing.sql"), matching every existing migration in this directory.',
    );
  }

  for (let i = 1; i < versions.length; i++) {
    if (versions[i].version <= versions[i - 1].version) {
      throw new Error(
        `Migration versions must be strictly increasing: "${versions[i - 1].file}" ` +
          `(${versions[i - 1].version}) is not less than "${versions[i].file}" (${versions[i].version}).`,
      );
    }
  }

  const { rows } = await client.query('SELECT filename, checksum FROM schema_migrations ORDER BY filename');
  const applied = new Map(rows.map((row) => [row.filename, row.checksum]));
  let appliedCount = applied.size;

  for (const filename of files) {
    const sql = await readFile(resolve(migrationsDir, filename), 'utf8');
    const checksum = createHash('sha256').update(sql).digest('hex');

    if (applied.has(filename)) {
      const recorded = applied.get(filename);
      if (recorded) {
        if (recorded !== checksum) {
          throw new Error(
            `Migration ${filename} has changed after being applied. ` +
              'Create a new migration instead of editing an existing one.',
          );
        }
      } else {
        // Backfill checksum for databases created before checksum tracking.
        await client.query(
          'UPDATE schema_migrations SET checksum = $2 WHERE filename = $1 AND checksum IS NULL',
          [filename, checksum],
        );
      }
      continue;
    }

    console.log(`Applying ${filename}...`);

    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query(
        'INSERT INTO schema_migrations (filename, checksum) VALUES ($1, $2)',
        [filename, checksum],
      );
      await client.query('COMMIT');
      appliedCount += 1;
    } catch (error) {
      await client.query('ROLLBACK');
      throw new Error(
        `Migration ${filename} failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  console.log(`Migration check complete: ${files.length} migration file(s), ${appliedCount} applied.`);
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('majalis-elm:schema-migrations'))").catch(() => undefined);
  await client.end().catch(() => undefined);
}
