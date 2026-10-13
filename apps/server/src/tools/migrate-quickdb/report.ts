import { plannedCounts } from './load.js';
import {
  APPLY_ORDER,
  type ApplyResult,
  type DictionaryCheck,
  type LegacyData,
  type MigrateOptions,
  ReportSchema,
  type Report,
  type Plan,
} from './types.js';

export function buildReport(input: {
  options: MigrateOptions;
  data: LegacyData;
  plan: Plan;
  dictionary: DictionaryCheck;
  applied: ApplyResult | null;
}): Report {
  const { options, data, plan, dictionary, applied } = input;
  const planned = plannedCounts(plan);
  return ReportSchema.parse({
    mode: options.apply ? 'apply' : 'dry-run',
    flags: {
      apply: options.apply,
      allowNonEmpty: options.allowNonEmpty,
      dictAsset: options.dictAsset !== null,
    },
    source: {
      rows: {
        birthday: data.rows.birthday.length,
        config: data.rows.config.length,
        note: data.rows.note.length,
        word: data.rows.word.length,
      },
      dictKeyCount: data.dictKeyCount,
      missingFiles: [...data.missingFiles],
      unparsableRows: data.unparsableRows,
    },
    tables: APPLY_ORDER.map((table) => ({
      table,
      planned: planned[table],
      inserted: applied ? applied.inserted[table] : null,
      existing: applied ? applied.existing[table] : null,
      targetBefore: applied ? applied.targetBefore[table] : null,
    })),
    skipped: plan.skipped,
    dictionary,
    failures: applied?.failures ?? [],
    allowedNonEmpty: applied?.allowedNonEmpty ?? false,
  });
}

/** Non-zero when an apply left a guild unloaded; a dry run never fails on data. */
export function exitCodeFor(report: Report): number {
  return report.failures.length > 0 ? 1 : 0;
}

/** Plain text, counts and codes only. */
export function formatReport(report: Report): string {
  const lines: string[] = [];
  lines.push(`Mode: ${report.mode}${report.mode === 'dry-run' ? ' (nothing written)' : ''}`);
  lines.push(
    `Flags: apply=${report.flags.apply} allow-non-empty=${report.flags.allowNonEmpty} ` +
      `dict-asset=${report.flags.dictAsset}`,
  );
  if (report.allowedNonEmpty)
    lines.push('WARNING: target was not empty; ran with --allow-non-empty');
  const { rows } = report.source;
  lines.push(
    `Source rows: birthday=${rows.birthday} config=${rows.config} word=${rows.word} note=${rows.note}` +
      ` dict-keys=${report.source.dictKeyCount ?? 'n/a'}`,
  );
  if (report.source.missingFiles.length > 0) {
    lines.push(`Missing source files: ${report.source.missingFiles.join(', ')}`);
  }
  if (report.source.unparsableRows > 0) {
    lines.push(`Unparsable source rows (not loaded): ${report.source.unparsableRows}`);
  }
  lines.push('Table                  planned  inserted  existing  target-before');
  for (const row of report.tables) {
    lines.push(
      `${row.table.padEnd(22)} ${String(row.planned).padStart(7)}  ` +
        `${String(row.inserted ?? '-').padStart(8)}  ${String(row.existing ?? '-').padStart(8)}  ` +
        `${String(row.targetBefore ?? '-').padStart(13)}`,
    );
  }
  const existingRows = report.tables.filter((row) => (row.existing ?? 0) > 0);
  if (existingRows.length > 0) {
    lines.push(
      `TARGET_ROW_EXISTS (existing, not overwritten): ${existingRows
        .map((row) => `${row.table}=${row.existing}`)
        .join(' ')}`,
    );
  }
  const skipped = Object.entries(report.skipped);
  lines.push(
    skipped.length === 0
      ? 'Skipped: none'
      : `Skipped: ${skipped.map(([code, count]) => `${code}=${count}`).join(' ')}`,
  );
  lines.push(`Dictionary check: ${report.dictionary.status}`);
  for (const failure of report.failures) {
    lines.push(`FAILED guild ${failure.guildKey}: ${failure.error}`);
  }
  return lines.join('\n');
}
