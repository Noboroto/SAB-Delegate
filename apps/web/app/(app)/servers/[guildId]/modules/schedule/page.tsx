import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ScheduleView } from '@/components/schedule/schedule-view';
import { getPendingSchedules } from '@/lib/schedule/get-schedules';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-schedule');
  return { title: t('title') };
}

export default async function SchedulePage({ params }: { params: Promise<{ guildId: string }> }) {
  const { guildId } = await params;
  const rows = await getPendingSchedules(guildId);

  return <ScheduleView guildId={guildId} rows={rows} />;
}
