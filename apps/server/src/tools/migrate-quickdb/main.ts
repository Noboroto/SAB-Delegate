import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import { resolveDatabaseUrl } from '../../config/database-url.js';
import { createPool, errorLabel } from '../../prisma/pool-factory.js';
import { ArgsError, USAGE, parseArgs } from './args.js';
import { exportClaims } from './export-claims.js';
import { TargetNotEmptyError, applyPlan } from './load.js';
import { checkDictionary, readLegacy } from './read-source.js';
import { buildReport, exitCodeFor, formatReport } from './report.js';
import { transform } from './transform.js';
import type { CliOptions } from './types.js';

/** One short-lived connection pool on the shared factory, so the session is UTC like the server's. */
async function withPrisma<T>(run: (prisma: PrismaClient) => Promise<T>): Promise<T> {
  const pool = createPool(resolveDatabaseUrl(process.env), 2);
  const prisma = new PrismaClient({ adapter: new PrismaPg(pool) });
  try {
    return await run(prisma);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

async function run(options: CliOptions): Promise<number> {
  if (options.command === 'export-claims') {
    const result = await withPrisma((prisma) => exportClaims(prisma, options));
    console.log(
      `Exported ${result.claims} claim(s) and ${result.exportedSending} in-flight (SENDING) run(s); ` +
        `${result.guildsNotInLegacy} guild(s) not in the legacy file`,
    );
    return 0;
  }

  const data = readLegacy(options.sourceDir);
  const plan = transform(data);
  const dictionary = checkDictionary(data.dictKeyCount, options.dictAsset);

  if (!options.apply) {
    console.log(formatReport(buildReport({ options, data, plan, dictionary, applied: null })));
    return 0;
  }

  try {
    const applied = await withPrisma((prisma) =>
      applyPlan(prisma, plan, { allowNonEmpty: options.allowNonEmpty }),
    );
    const report = buildReport({ options, data, plan, dictionary, applied });
    console.log(formatReport(report));
    return exitCodeFor(report);
  } catch (error) {
    if (error instanceof TargetNotEmptyError) {
      console.error(error.message);
      return 2;
    }
    throw error;
  }
}

async function main(): Promise<void> {
  let options: CliOptions;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    if (error instanceof ArgsError) {
      console.error(`${error.message}\n${USAGE}`);
      process.exitCode = 64;
      return;
    }
    throw error;
  }
  try {
    process.exitCode = await run(options);
  } catch (error) {
    // Name only: driver and file errors can echo paths, hosts or row content.
    console.error(`migrate-quickdb failed: ${errorLabel(error)}`);
    process.exitCode = 1;
  }
}

void main();
