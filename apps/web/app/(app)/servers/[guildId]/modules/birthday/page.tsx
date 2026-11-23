import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { BirthdayPage } from '@/components/birthday/birthday-page';
import { getBirthdayWishes } from '@/lib/birthday/get-birthday-wishes';
import { getBirthdays, parseMonthParam } from '@/lib/birthday/get-birthdays';
import { parseBirthdayTab } from '@/lib/birthday/tabs';

type BirthdayParams = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<{ month?: string | string[]; tab?: string | string[] }>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-birthday');
  return { title: t('title') };
}

/** Each tab reads only what it shows, so one failing read never takes the other tab down. */
export default async function BirthdayModulePage({ params, searchParams }: BirthdayParams) {
  const [{ guildId }, query] = await Promise.all([params, searchParams]);
  if (parseBirthdayTab(query.tab) === 'wishes') {
    const wishes = await getBirthdayWishes(guildId);
    return <BirthdayPage guildId={guildId} tab="wishes" wishes={wishes} />;
  }
  const month = parseMonthParam(query.month);
  const entries = await getBirthdays(guildId, month);
  return <BirthdayPage guildId={guildId} tab="list" entries={entries} month={month} />;
}
