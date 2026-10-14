import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { SectionStub } from '@/components/layout/section-stub';
import { isGuildSection } from '@/lib/guild-sections';

type SectionParams = { params: Promise<{ guildId: string; section: string }> };

export async function generateMetadata({ params }: SectionParams): Promise<Metadata> {
  const { section } = await params;
  if (!isGuildSection(section)) return {};
  const t = await getTranslations('servers.nav');
  return { title: t(section) };
}

/** Stub for the pages of later features; any other path under a server is a 404. */
export default async function GuildSectionPage({ params }: SectionParams) {
  const { section } = await params;
  if (!isGuildSection(section)) notFound();
  const t = await getTranslations('servers.nav');
  return <SectionStub title={t(section)} />;
}
