import { describe, expect, it } from 'vitest';
import { buildCodeMail, buildTestMail, escapeHtml } from './mail-template.js';

const hostile = '<script>alert(1)</script> & "Co" \'x\'\r\nBcc: evil@example.test';

describe('escapeHtml', () => {
  it('escapes the five characters that matter', () => {
    expect(escapeHtml(`<a href="x">&'`)).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
  });
});

describe('buildCodeMail', () => {
  for (const locale of ['vi', 'en']) {
    it(`escapes the server name in the html and keeps the subject on one line (${locale})`, () => {
      const mail = buildCodeMail({ locale, guildName: hostile, code: '012345' });
      expect(mail.html).not.toContain('<script>');
      expect(mail.html).toContain('&lt;script&gt;');
      expect(mail.html).toContain('012345');
      expect(mail.subject).not.toMatch(/[\r\n]/);
      expect(mail.text).toContain('012345');
    });
  }

  it('escapes a code that is not digits', () => {
    expect(buildCodeMail({ locale: 'en', guildName: 'S', code: '<b>' }).html).not.toContain('<b>');
  });
});

describe('buildTestMail', () => {
  it('escapes the server name', () => {
    const mail = buildTestMail({ locale: 'en', guildName: hostile });
    expect(mail.html).not.toContain('<script>');
    expect(mail.subject).not.toMatch(/[\r\n]/);
  });
});
