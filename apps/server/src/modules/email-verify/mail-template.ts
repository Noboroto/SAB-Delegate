import { EMAIL_CODE_TTL_MINUTES } from '@sab/shared';
import { translatorFor } from '../../i18n/translator.js';

type BuiltMail = { subject: string; text: string; html: string };

const HTML_ESCAPES: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

/** Every value that comes from outside (a server name above all) goes through this before it enters HTML. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => HTML_ESCAPES[char] ?? char);
}

/** A server name on one line: it goes into a header, where a line break would start a new one. */
function oneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function page(heading: string, paragraphs: readonly string[], highlight?: string): string {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 16px;font-size:15px;line-height:1.5">${text}</p>`)
    .join('');
  const code =
    highlight === undefined
      ? ''
      : `<p style="margin:0 0 16px;font-size:32px;font-weight:700;letter-spacing:8px;font-family:Consolas,Menlo,monospace">${highlight}</p>`;
  return (
    '<!doctype html><html><body style="margin:0;padding:24px;background:#f4f5f7;color:#1f2933;font-family:Arial,Helvetica,sans-serif">' +
    '<div style="max-width:480px;margin:0 auto;padding:24px;background:#ffffff;border-radius:8px">' +
    `<h1 style="margin:0 0 16px;font-size:20px">${heading}</h1>${body}${code}</div></body></html>`
  );
}

/** The mail that carries a verification code, in the server's language. */
export function buildCodeMail(input: {
  locale: string;
  guildName: string;
  code: string;
}): BuiltMail {
  const t = translatorFor(input.locale);
  const minutes = EMAIL_CODE_TTL_MINUTES;
  const server = oneLine(input.guildName);
  return {
    subject: t('email-verify.mail.subject', { server }),
    text: t('email-verify.mail.text', { server, code: input.code, minutes }),
    html: page(
      escapeHtml(t('email-verify.mail.heading')),
      [
        escapeHtml(t('email-verify.mail.intro', { server })),
        escapeHtml(t('email-verify.mail.expires', { minutes })),
        escapeHtml(t('email-verify.mail.ignore')),
      ],
      escapeHtml(input.code),
    ),
  };
}

/** The mail that checks the setup works, in the server's language. */
export function buildTestMail(input: { locale: string; guildName: string }): BuiltMail {
  const t = translatorFor(input.locale);
  const server = oneLine(input.guildName);
  return {
    subject: t('email-verify.mail.testSubject', { server }),
    text: t('email-verify.mail.testText', { server }),
    html: page(escapeHtml(t('email-verify.mail.heading')), [
      escapeHtml(t('email-verify.mail.testText', { server })),
    ]),
  };
}
