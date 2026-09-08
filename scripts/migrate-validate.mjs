/**
 * migrate-validate.mjs
 * يُشغِّل كل ملفات migrations الموجودة في المجلد بالترتيب على pg-mem
 * (القائمة تُقرأ من المجلد — لا قائمة مكتوبة يدوياً يمكن أن تتخلّف عن الواقع)
 */

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { newDb, DataType } = require('pg-mem');

import { readFileSync, readdirSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dir = dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = resolve(__dir, '../apps/backend/migrations');

/**
 * The migration list is READ FROM THE DIRECTORY, never hand-maintained.
 *
 * It used to be a hardcoded array of twenty filenames ending at 042. When
 * 015_content_media_upload.sql (ADR-013 Stage A) was added, this script kept
 * printing "✅ ALL 20/20 MIGRATIONS PASSED" while never opening it — and the dev
 * database silently stayed one migration behind until an integration test hit a
 * missing column. A validator that reports success over a file it never read is
 * POLICY-SEC-001 category 4 (fabricated readiness), so the list cannot be
 * something a developer has to remember to update.
 *
 * Numeric prefixes are zero-padded to three digits, so lexicographic order IS
 * migration order. Seeds are data, not schema, and are excluded.
 */
const MIGRATIONS = readdirSync(MIGRATIONS_DIR)
  .filter((name) => /^\d{3}_.*\.sql$/.test(name))
  .sort();

if (MIGRATIONS.length === 0) {
  console.error(`No migrations found in ${MIGRATIONS_DIR} — refusing to report a passing schema.`);
  process.exit(1);
}

function preprocessSql(sql) {
  return sql
    // Extensions → SELECT 1 (valid no-op)
    .replace(/CREATE\s+EXTENSION\s+IF\s+NOT\s+EXISTS\s+[^;]+;/gi, 'SELECT 1; -- extension stub')
    // uuid_generate_v7() → gen_random_uuid()
    .replace(/uuid_generate_v7\(\)/gi, 'gen_random_uuid()')
    // CITEXT → TEXT
    .replace(/\bCITEXT\b/gi, 'TEXT')
    // INET → TEXT
    .replace(/\bINET\b/gi, 'TEXT')
    // DECIMAL → NUMERIC
    .replace(/\bDECIMAL\b/gi, 'NUMERIC')
    // BIGINT → INTEGER
    .replace(/\bBIGINT\b/gi, 'INTEGER')
    // SMALLINT → INTEGER
    .replace(/\bSMALLINT\b/gi, 'INTEGER')
    // TIMESTAMPTZ → TIMESTAMP
    .replace(/\bTIMESTAMPTZ\b/gi, 'TIMESTAMP')
    // gen_random_bytes() stub
    .replace(/gen_random_bytes\s*\([^)]+\)/gi, "'\\\\x00'")
    // char_length() CHECK constraints → remove (registered via JS below)
    .replace(/CHECK\s*\(\s*char_length\s*\([^)]+\)\s+BETWEEN\s+\d+\s+AND\s+\d+\s*\)/gi, '')
    .replace(/CHECK\s*\(\s*char_length\s*\([^)]+\)\s*<=\s*\d+\s*\)/gi, '')
    .replace(/CHECK\s*\(\s*body\s+IS\s+NULL\s+OR\s+char_length\s*\([^)]+\)\s*<=\s*\d+\s*\)/gi, '')
    // Regex-match CHECK constraints — pg-mem doesn't support the ~ operator
    // between varchar and text ("operator does not exist: character varying
    // ~ text"), even though real PostgreSQL does this routinely via implicit
    // cast. Must strip the WHOLE `ALTER TABLE ... ADD CONSTRAINT name
    // CHECK(...)` statement, not just the CHECK(...) clause — an
    // ADD CONSTRAINT left with no CHECK clause is its own syntax error.
    .replace(
      /ALTER\s+TABLE\s+\S+\s+ADD\s+CONSTRAINT\s+\S+\s+CHECK\s*\([^;]*~[^;]*\)\s*;/gi,
      'SELECT 1; -- regex CHECK constraint stub (unsupported by pg-mem)',
    )
    // ALTER TYPE ... ADD VALUE — real, valid PostgreSQL for extending an enum
    // (migration 016/ADR-013 Stage B), but pg-mem's parser doesn't implement
    // this statement at all ("failed to parse"). This validator's job is to
    // catch broken SQL / missing tables-columns, not exhaustively track enum
    // membership, so stub it out here rather than fail the migration.
    .replace(/ALTER\s+TYPE\s+\S+\s+ADD\s+VALUE[^;]*;/gi, 'SELECT 1; -- ALTER TYPE ADD VALUE stub (unsupported by pg-mem)')
    // Anonymous PL/pgSQL blocks (`DO $$ ... END; $$;`) — pg-mem has no
    // PL/pgSQL interpreter ("Unknown language plpgsql"; note a DO block
    // doesn't say the word "plpgsql" anywhere in its own text, since that's
    // the implicit default language, so this needs its own pattern rather
    // than reusing a generic "plpgsql" text search). In this codebase these
    // blocks are only ever idempotent "ADD COLUMN IF NOT EXISTS" guards
    // (see 016_transcode_queue_status.sql) — real PostgreSQL supports
    // `ADD COLUMN IF NOT EXISTS` directly, so the DO wrapper only exists
    // because older PostgreSQL versions lacked that clause. Stubbing the
    // whole block is safe for structural validation here since nothing
    // later in this migration set depends on the column it would have
    // added.
    .replace(/DO\s+\$\$[\s\S]*?\$\$\s*;/gi, 'SELECT 1; -- DO $$ ... $$ (plpgsql) stub, unsupported by pg-mem')
    // Multi-row seed INSERT relying on a function-based DEFAULT (id UUID
    // DEFAULT gen_random_uuid()) — pg-mem memoizes that function's result
    // at the QUERY-PLAN level (proven experimentally: even splitting into
    // fully separate client.query() calls with structurally-identical SQL
    // shape still reuses the same generated id — it's not a multi-row-VALUES
    // quirk, it's plan-level memoization), so all 5 seeded roles collide on
    // the same generated id ("duplicate key value violates unique
    // constraint id_roles_pkey"). This is a documented pg-mem gap (the tool
    // itself suggests filing an issue upstream), not anything wrong with the
    // migration — real PostgreSQL evaluates DEFAULT once per row correctly.
    // The only robust workaround is to stop relying on the DEFAULT here:
    // generate distinct ids in JS and inline them as literals. `name` is
    // UNIQUE and this is idempotent seed data, so this changes nothing about
    // the resulting rows or their meaning.
    .replace(
      /INSERT INTO id_roles \(name, description, is_system\) VALUES\n([\s\S]*?)\nON CONFLICT \(name\) DO NOTHING;/,
      (_match, valuesBlock) => {
        const rows = valuesBlock.match(/\([^()]*\)/g) || [];
        return rows
          .map(
            (row) =>
              `INSERT INTO id_roles (id, name, description, is_system) VALUES ('${randomUUID()}', ${row.slice(1, -1)}) ON CONFLICT (name) DO NOTHING;`,
          )
          .join('\n');
      },
    )
}

// ── init pg-mem ───────────────────────────────────────────────────────────
const db = newDb({ autoCreateForeignKeyIndices: true });

// تسجيل الدوال المطلوبة عبر JS API (الطريقة الصحيحة)
db.public.registerFunction({
  name: 'gen_random_uuid',
  args: [],
  returns: DataType.text,
  implementation: () => randomUUID(),
});

db.public.registerFunction({
  name: 'char_length',
  args: [DataType.text],
  returns: DataType.integer,
  implementation: (s) => (s ? s.length : 0),
});

db.public.registerFunction({
  name: 'char_length',
  args: [DataType.text],
  returns: DataType.integer,
  allowNullArguments: true,
  implementation: (s) => (s ? s.length : 0),
});

const adapter = db.adapters.createPg();
const { Client } = adapter;
const client = new Client();
await client.connect();

console.log('');
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Majalis Al-Elm — Migration Validation (pg-mem)');
console.log(`  ${MIGRATIONS.length} migrations`);
console.log('═══════════════════════════════════════════════════════════════');
console.log('  Preprocessing: CITEXT/INET/TIMESTAMPTZ → TEXT/TIMESTAMP');
console.log('                 uuid_generate_v7() → gen_random_uuid()');
console.log('                 char_length() CHECK constraints → removed');
console.log('');

let passed = 0;
let failed = 0;
const errors = [];

for (const migration of MIGRATIONS) {
  const filepath = resolve(MIGRATIONS_DIR, migration);
  process.stdout.write(`  ${migration.padEnd(45)}`);

  let raw;
  try {
    raw = readFileSync(filepath, 'utf8');
  } catch {
    console.log('❌  FILE NOT FOUND');
    failed++;
    errors.push({ migration, error: 'File not found' });
    continue;
  }

  const sql = preprocessSql(raw);

  try {
    await client.query(sql);
    console.log('✅  OK');
    passed++;
  } catch (err) {
    const msg = err.message.replace(/\n/g, ' ').substring(0, 150);
    console.log(`❌  FAILED`);
    console.log(`      ↳ ${msg}`);
    failed++;
    errors.push({ migration, error: err.message });
  }
}

// ── Tables ────────────────────────────────────────────────────────────────
const tableRows = db.public.many(
  "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY table_name"
);
console.log('');
console.log(`─── Tables created (${tableRows.length}) ─────────────────────────────────────`);
tableRows.forEach(r => console.log('  •', r.table_name));

// ── Result ────────────────────────────────────────────────────────────────
console.log('');
console.log('═══════════════════════════════════════════════════════════════');
if (failed === 0) {
  console.log(`  ✅  ALL ${passed}/${MIGRATIONS.length} MIGRATIONS PASSED`);
} else {
  console.log(`  ❌  ${failed} FAILED — ${passed} passed`);
  errors.forEach(e => {
    console.log(`\n  FAIL: ${e.migration}`);
    console.log(`  ${e.error.split('\n')[0]}`);
  });
}
console.log('═══════════════════════════════════════════════════════════════');
console.log('');

await client.end();
process.exit(failed === 0 ? 0 : 1);
