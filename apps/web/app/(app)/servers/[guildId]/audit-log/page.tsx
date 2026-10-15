import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { AuditLogList } from '@/components/audit-log/audit-log-list';
import { parseAuditLogsFilter } from '@/lib/audit-log/audit-logs';
import { getAuditLogs } from '@/lib/audit-log/get-audit-logs';

type AuditLogProps = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-audit-log');
  return { title: t('title') };
}

export default async function AuditLogPage({ params, searchParams }: AuditLogProps) {
  const { guildId } = await params;
  const filter = parseAuditLogsFilter(await searchParams);
  const page = await getAuditLogs(guildId, filter);
  return <AuditLogList guildId={guildId} page={page} filter={filter} />;
}
