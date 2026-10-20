import {
  AccessRulesInputSchema,
  AccessRulesViewSchema,
  EmailBlocklistSchema,
  EmailListCreateSchema,
  EmailListEntriesInputSchema,
  EmailListEntriesResultSchema,
  EmailListSummarySchema,
  EmailManualVerifyInputSchema,
  EmailMemberRowSchema,
  EmailTestMailInputSchema,
  EmailVerifyButtonInputSchema,
  EmailVerifyButtonResultSchema,
  EmailVerifyConfigPatchSchema,
  EmailVerifyConfigSchema,
  SmtpSettingsInputSchema,
  SmtpSettingsSchema,
  SmtpTestResultSchema,
  z,
  type AccessRulesInput,
  type AccessRulesView,
  type EmailBlocklist,
  type EmailListCreate,
  type EmailListEntriesInput,
  type EmailListEntriesResult,
  type EmailListSummary,
  type EmailManualVerifyInput,
  type EmailMemberRow,
  type EmailTestMailInput,
  type EmailVerifyButtonInput,
  type EmailVerifyButtonResult,
  type EmailVerifyConfig,
  type EmailVerifyConfigPatch,
  type SmtpSettings,
  type SmtpSettingsInput,
  type SmtpTestResult,
} from '@sab/shared';
import { apiFetch } from '@/lib/api/api-fetch';
import { guildApiPath } from '@/lib/guild-path';

const path = (guildId: string, ...rest: string[]) => guildApiPath(guildId, 'email-verify', ...rest);

/** An answer whose body the dashboard does not read (empty, or the thing removed). */
const AnyAnswerSchema = z.unknown();

/** A field left out is left alone. */
export function configureEmailVerify(
  guildId: string,
  patch: EmailVerifyConfigPatch,
): Promise<EmailVerifyConfig> {
  return apiFetch(path(guildId, 'config'), {
    method: 'PATCH',
    body: EmailVerifyConfigPatchSchema.parse(patch),
    parser: EmailVerifyConfigSchema,
  });
}

/** Replaces the server's whole rule set. */
export function saveEmailRules(guildId: string, input: AccessRulesInput): Promise<AccessRulesView> {
  return apiFetch(path(guildId, 'rules'), {
    method: 'PUT',
    body: AccessRulesInputSchema.parse(input),
    parser: AccessRulesViewSchema,
  });
}

/** Replaces the server's whole blocklist. */
export function saveEmailBlocklist(
  guildId: string,
  input: EmailBlocklist,
): Promise<EmailBlocklist> {
  return apiFetch(path(guildId, 'blocklist'), {
    method: 'PUT',
    body: EmailBlocklistSchema.parse(input),
    parser: EmailBlocklistSchema,
  });
}

export function createEmailList(
  guildId: string,
  input: EmailListCreate,
): Promise<EmailListSummary> {
  return apiFetch(path(guildId, 'lists'), {
    method: 'POST',
    body: EmailListCreateSchema.parse(input),
    parser: EmailListSummarySchema,
  });
}

export function deleteEmailList(guildId: string, listId: string): Promise<unknown> {
  return apiFetch(path(guildId, 'lists', listId), { method: 'DELETE', parser: AnyAnswerSchema });
}

/** The server normalises the addresses and counts the ones it could not use. */
export function addEmailListEntries(
  guildId: string,
  listId: string,
  input: EmailListEntriesInput,
): Promise<EmailListEntriesResult> {
  return apiFetch(path(guildId, 'lists', listId, 'entries'), {
    method: 'POST',
    body: EmailListEntriesInputSchema.parse(input),
    parser: EmailListEntriesResultSchema,
  });
}

export function removeEmailListEntries(
  guildId: string,
  listId: string,
  input: EmailListEntriesInput,
): Promise<EmailListEntriesResult> {
  return apiFetch(path(guildId, 'lists', listId, 'entries', 'remove'), {
    method: 'POST',
    body: EmailListEntriesInputSchema.parse(input),
    parser: EmailListEntriesResultSchema,
  });
}

/** Empties the list but keeps it. */
export function clearEmailListEntries(guildId: string, listId: string): Promise<unknown> {
  return apiFetch(path(guildId, 'lists', listId, 'entries'), {
    method: 'DELETE',
    parser: AnyAnswerSchema,
  });
}

/** Confirms a member's address by hand, without a code. */
export function verifyEmailMember(
  guildId: string,
  input: EmailManualVerifyInput,
): Promise<EmailMemberRow> {
  return apiFetch(path(guildId, 'members'), {
    method: 'POST',
    body: EmailManualVerifyInputSchema.parse(input),
    parser: EmailMemberRowSchema,
  });
}

export function revokeEmailMember(guildId: string, userId: string): Promise<unknown> {
  return apiFetch(path(guildId, 'members', userId), {
    method: 'DELETE',
    parser: AnyAnswerSchema,
  });
}

/** Same-origin link of the Excel export; the browser sends the login cookie and saves the file. */
export function emailMembersExportPath(guildId: string): string {
  return path(guildId, 'members', 'export');
}

export function postEmailVerifyButton(
  guildId: string,
  input: EmailVerifyButtonInput,
): Promise<EmailVerifyButtonResult> {
  return apiFetch(path(guildId, 'button'), {
    method: 'POST',
    body: EmailVerifyButtonInputSchema.parse(input),
    parser: EmailVerifyButtonResultSchema,
  });
}

export function sendEmailTestMail(guildId: string, input: EmailTestMailInput): Promise<unknown> {
  return apiFetch(path(guildId, 'test-mail'), {
    method: 'POST',
    body: EmailTestMailInputSchema.parse(input),
    parser: AnyAnswerSchema,
  });
}

/** Needs a recent login; the password may be left out to keep the stored one. */
export function saveSmtpSettings(guildId: string, input: SmtpSettingsInput): Promise<SmtpSettings> {
  return apiFetch(path(guildId, 'smtp'), {
    method: 'PUT',
    body: SmtpSettingsInputSchema.parse(input),
    parser: SmtpSettingsSchema,
  });
}

/**
 * Opens a connection with the SAVED mail server, whether or not sending is on;
 * the request carries no values, so what is typed in the form is not tested.
 */
export function testSmtpSettings(guildId: string): Promise<SmtpTestResult> {
  return apiFetch(path(guildId, 'smtp', 'test'), {
    method: 'POST',
    parser: SmtpTestResultSchema,
  });
}
