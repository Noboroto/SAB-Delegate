import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import {
  EmailVerifyView,
  type EmailVerifyTabProps,
} from '@/components/email-verify/email-verify-view';
import { lastPageIfPastEnd } from '@/lib/chatbot/last-page';
import {
  getEmailBlocklist,
  getEmailLists,
  getEmailMembers,
  getEmailRules,
  getEmailVerifyConfig,
  getEmailVerifyStatus,
  getSmtpSettings,
} from '@/lib/email-verify/get-email-verify';
import { membersQueryString, parseMembersQuery } from '@/lib/email-verify/members-query';
import { parseEmailVerifyTab, type EmailVerifyTab } from '@/lib/email-verify/tabs';

type EmailVerifyProps = {
  params: Promise<{ guildId: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-email-verify');
  return { title: t('title') };
}

/** Reads what one tab shows; the members tab sends a page past the end back to the last one. */
async function loadTab(
  guildId: string,
  tab: EmailVerifyTab,
  query: Record<string, string | string[] | undefined>,
): Promise<EmailVerifyTabProps> {
  switch (tab) {
    case 'settings':
      return { tab, config: await getEmailVerifyConfig(guildId) };
    case 'rules': {
      const [rules, lists, blocklist, config] = await Promise.all([
        getEmailRules(guildId),
        getEmailLists(guildId),
        getEmailBlocklist(guildId),
        getEmailVerifyConfig(guildId),
      ]);
      return { tab, rules, lists, blocklist, config };
    }
    case 'lists':
      return { tab, lists: await getEmailLists(guildId) };
    case 'members': {
      const membersQuery = parseMembersQuery(query);
      const members = await getEmailMembers(guildId, membersQuery);
      const last = lastPageIfPastEnd(members);
      if (last !== undefined) {
        redirect(
          `/servers/${guildId}/modules/email-verify?tab=members&${membersQueryString({ ...membersQuery, page: last })}`,
        );
      }
      return { tab, members, query: membersQuery };
    }
    case 'smtp':
      return { tab };
    case 'overview':
      return { tab, status: await getEmailVerifyStatus(guildId) };
  }
}

export default async function EmailVerifyPage({ params, searchParams }: EmailVerifyProps) {
  const { guildId } = await params;
  const query = await searchParams;
  const asked = parseEmailVerifyTab(query['tab']);

  // Every tab needs to know whether this is the admin server (the mail server's tab exists there only);
  // the two reads do not depend on each other, so they run together.
  const [smtp, shown] = await Promise.all([
    getSmtpSettings(guildId),
    loadTab(guildId, asked, query),
  ]);
  const props =
    shown.tab === 'smtp' && !smtp.adminServer ? await loadTab(guildId, 'overview', query) : shown;

  return <EmailVerifyView guildId={guildId} smtp={smtp} {...props} />;
}
