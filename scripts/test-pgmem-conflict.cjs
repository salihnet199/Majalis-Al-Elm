const pgmem = require('../apps/backend/node_modules/pg-mem');
const { newDb, DataType } = pgmem;
const { randomUUID } = require('crypto');

async function main() {
  const db = newDb();
  db.public.registerFunction({
    name: 'gen_random_uuid',
    args: [],
    returns: DataType.text,
    implementation: () => randomUUID()
  });
  const adapter = db.adapters.createPg();
  const { Client } = adapter;
  const c = new Client();
  await c.connect();
  await c.query('CREATE TABLE t (id text DEFAULT gen_random_uuid(), nm varchar(50) NOT NULL UNIQUE, PRIMARY KEY(id))');

  // اختبار 1: multi-row ON CONFLICT
  try {
    await c.query("INSERT INTO t (nm) VALUES ($1), ($2) ON CONFLICT (nm) DO NOTHING", ['b', 'c']);
    console.log('Test 1 (multi-row ON CONFLICT): OK');
  } catch(e) {
    console.log('Test 1 (multi-row ON CONFLICT): FAIL ->', e.message.slice(0,200));
  }

  // اختبار 2: ماذا لو فصلنا الـ INSERT إلى سطور منفصلة؟
  try {
    await c.query("INSERT INTO t (nm) VALUES ($1) ON CONFLICT (nm) DO NOTHING", ['x']);
    await c.query("INSERT INTO t (nm) VALUES ($1) ON CONFLICT (nm) DO NOTHING", ['x']); // duplicate
    console.log('Test 2 (single-row ON CONFLICT idempotent): OK');
  } catch(e) {
    console.log('Test 2: FAIL ->', e.message.slice(0,200));
  }

  await c.end();
}
main().catch(e => console.error('Unhandled:', e.message.slice(0,200)));
