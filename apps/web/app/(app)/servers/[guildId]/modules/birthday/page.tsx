import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BirthdayPage } from '@/components/birthday/birthday-page';
import { getBirthdays, parseMonthParam } from '@/lib/birthday/get-birthdays';

type BirthdayParams = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ month?: string | string[] }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-birthday');
  return { title: t('title') };
}

export default async function BirthdayModulePage({ params, searchParams }: BirthdayParams) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
  const month = parseMonthParam(query.month);
  const entries = await getBirthdays(guildId, month);
  return <BirthdayPage guildId={guildId} entries={entries} month={month} />;
}
