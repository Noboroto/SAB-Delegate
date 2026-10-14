import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { NotePage } from '@/components/note/note-page';
import { getNotes } from '@/lib/note/get-notes';

type NoteParams = { params: Promise<{ guildId: string }> };

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-note');
  return { title: t('title') };
}

export default async function NoteModulePage({ params }: NoteParams) {
  const { guildId } = await params;
  const notes = await getNotes(guildId);
  return <NotePage guildId={guildId} notes={notes} />;
}
