// Release step: installs or upgrades the pg-boss schema as the migrate role and
// lets the runtime role use it. The server connects as the runtime role, which
// has no CREATE, and starts pg-boss with migrate and createSchema off, so
// without this step it would find no schema and refuse to start.
//
// Connection comes from the libpq variables (PGHOST, PGPORT, PGUSER, PGPASSWORD,
// PGDATABASE) that release.sh exports for the migrate role. POSTGRES_USER is the
// runtime role. PGBOSS_SCHEMA overrides the schema name (tests only).
//
// Failures are reported by error name: messages can carry connection details.
import pg from 'pg';
import { PgBoss } from 'pg-boss';

const schema = process.env.PGBOSS_SCHEMA || 'pgboss';
const runtime = process.env.POSTGRES_USER;
const connection = {
  host: process.env.PGHOST,
  port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
};

if (!runtime || !connection.user || !connection.database) {
  console.error('install-pgboss: POSTGRES_USER, PGUSER and PGDATABASE are required');
  process.exit(1);
}

async function install() {
  const boss = new PgBoss({
    ...connection,
    schema,
    max: 2,
    application_name: 'sab-release',
    // Installs and migrates only; no workers, no cron, no maintenance loop.
    migrate: true,
    createSchema: true,
    supervise: false,
    schedule: false,
  });
  boss.on('error', (error) => console.error(`install-pgboss: pg-boss error ${error.name}`));
  try {
    await boss.start({ attempts: 5 });
  } finally {
    await boss.stop({ graceful: true, timeout: 10_000 });
  }
}

async function grant() {
  const client = new pg.Client(connection);
  await client.connect();
  try {
    const s = pg.escapeIdentifier(schema);
    const r = pg.escapeIdentifier(runtime);
    const m = pg.escapeIdentifier(connection.user);
    await client.query('BEGIN');
    await client.query(`GRANT USAGE ON SCHEMA ${s} TO ${r}`);
    await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${s} TO ${r}`);
    await client.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ${s} TO ${r}`);
    await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ${s} TO ${r}`);
    // Objects a later pg-boss upgrade creates as the migrate role.
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA ${s} GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${r}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA ${s} GRANT USAGE, SELECT ON SEQUENCES TO ${r}`,
    );
    await client.query(
      `ALTER DEFAULT PRIVILEGES FOR ROLE ${m} IN SCHEMA ${s} GRANT EXECUTE ON FUNCTIONS TO ${r}`,
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    await client.end();
  }
}

try {
  await install();
  await grant();
  console.log(`install-pgboss: schema "${schema}" ready for the runtime role`);
} catch (error) {
  console.error(`install-pgboss: failed (${error instanceof Error ? error.name : 'UnknownError'})`);
  process.exit(1);
}
