import {
  AccessRulesViewSchema,
  EmailBlocklistSchema,
  EmailListSummarySchema,
  EmailMemberPageSchema,
  EmailVerifyConfigSchema,
  EmailVerifyStatusSchema,
  SmtpSettingsSchema,
  z,
  type AccessRulesView,
  type EmailBlocklist,
  type EmailListSummary,
  type EmailMemberListQuery,
  type EmailMemberPage,
  type EmailVerifyConfig,
  type EmailVerifyStatus,
  type SmtpSettings,
} from '@sab/shared';
import { serverFetch } from '@/lib/api/server-fetch';
import { guildApiPath } from '@/lib/guild-path';
import { membersQueryString } from './members-query';

/** What the server component and the browser both parse the list of lists with. */
const EmailListsSchema = z.array(EmailListSummarySchema);

const path = (guildId: string, ...rest: string[]) => guildApiPath(guildId, 'email-verify', ...rest);

export function getEmailVerifyStatus(guildId: string): Promise<EmailVerifyStatus> {
  return serverFetch(path(guildId, 'status'), { parser: EmailVerifyStatusSchema });
}

export function getEmailVerifyConfig(guildId: string): Promise<EmailVerifyConfig> {
  return serverFetch(path(guildId, 'config'), { parser: EmailVerifyConfigSchema });
}

/** The rules with the text form of each condition and the lists they name that no longer exist. */
export function getEmailRules(guildId: string): Promise<AccessRulesView> {
  return serverFetch(path(guildId, 'rules'), { parser: AccessRulesViewSchema });
}

export function getEmailBlocklist(guildId: string): Promise<EmailBlocklist> {
  return serverFetch(path(guildId, 'blocklist'), { parser: EmailBlocklistSchema });
}

export function getEmailLists(guildId: string): Promise<EmailListSummary[]> {
  return serverFetch(path(guildId, 'lists'), { parser: EmailListsSchema });
}

export function getEmailMembers(
  guildId: string,
  query: EmailMemberListQuery,
): Promise<EmailMemberPage> {
  return serverFetch(`${path(guildId, 'members')}?${membersQueryString(query)}`, {
    parser: EmailMemberPageSchema,
  });
}

/** The mail server's settings as this server's managers may see them; see `SmtpSettings.adminServer`. */
export function getSmtpSettings(guildId: string): Promise<SmtpSettings> {
  return serverFetch(path(guildId, 'smtp'), { parser: SmtpSettingsSchema });
}
