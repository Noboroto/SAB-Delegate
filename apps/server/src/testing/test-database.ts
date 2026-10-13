import { randomBytes } from 'node:crypto';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { createPool } from '../prisma/pool-factory.js';

const MIGRATIONS_DIR = join(__dirname, '..', '..', 'prisma', 'migrations');

/**
 * A private schema holding the committed migrations, on the throwaway server
 * the test harness already vetted (loopback, a database named `*_test`).
 * `server` is what `requireDatabaseUrl()` from the harness returns: a spec
 * without a reachable database fails there instead of skipping.
 *
 * Every call gets its own schema, so spec files and tests running in parallel
 * never see each other's rows. The migration files are applied as written
 * rather than through `prisma migrate deploy`, which is how a spec can create
 * a fresh database in milliseconds and still exercise the hand-written CHECKs.
 */
export async function createTestDatabase(server: { url: string }) {
  const base = new URL(server.url);
  // The schema the global setup migrated is not this database's schema.
  base.searchParams.delete('schema');
  const connectionString = base.toString();

  // Hex only, so interpolating it into DDL below cannot inject anything.
  const schema = `t_${randomBytes(6).toString('hex')}`;
  const quoted = `"${schema}"`;

  const dropSchema = async (): Promise<void> => {
    const admin = createPool(connectionString, 1);
    try {
      await admin.query(`DROP SCHEMA IF EXISTS ${quoted} CASCADE`);
    } finally {
      await admin.end();
    }
  };

  const admin = createPool(connectionString, 1);
  try {
    await admin.query(`CREATE SCHEMA ${quoted}`);
    const client = await admin.connect();
    try {
      // Unqualified CREATE statements land in the first schema of the path.
      await client.query(`SET search_path TO ${quoted}`);
      const folders = (await readdir(MIGRATIONS_DIR, { withFileTypes: true }))
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
        .sort();
      for (const folder of folders) {
        await client.query(await readFile(join(MIGRATIONS_DIR, folder, 'migration.sql'), 'utf8'));
      }
    } finally {
      client.release();
    }
  } catch (error) {
    await admin.end();
    await dropSchema();
    throw error;
  }
  await admin.end();

  // The search_path covers raw SQL a spec writes without a schema prefix; the
  // adapter's `schema` covers the queries Prisma generates.
  const pool = createPool(connectionString, 4, `-c timezone=UTC -c search_path=${schema}`);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool, { schema }) });

  let disposed = false;
  return {
    prisma,
    schema,
    async dispose() {
      if (disposed) return;
      disposed = true;
      try {
        await prisma.$disconnect();
      } finally {
        try {
          await pool.end();
        } finally {
          await dropSchema();
        }
      }
    },
  };
}

/**
 * `prisma` is bound to this database's own schema (unrelated to PrismaService);
 * `dispose` drops the schema and closes every connection, and is safe to call
 * twice.
 */
export type TestDatabase = Awaited<ReturnType<typeof createTestDatabase>>;
