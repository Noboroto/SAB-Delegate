import 'reflect-metadata';
import { EMAIL_CODE_TTL_MINUTES, ErrorCode, MESSAGES } from '@sab/shared';
import { MessageFlags, type ModalBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import { emailVerifyCustomId, parseEmailVerifyCustomId } from './email-verify.ids.js';
import { EmailVerifyInteractions } from './email-verify.interactions.js';
import type { EmailVerifyService } from './email-verify.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const ROLE = '300000000000000001';

type Json = { custom_id: string; title: string; components: unknown[] };

function build(overrides: Partial<Record<keyof EmailVerifyService, unknown>> = {}) {
  const verify = {
    requestCode: vi.fn().mockResolvedValue({
      status: 'SENT',
      maskedEmail: 'a***@school.edu',
      expiresAt: new Date(0),
      pendingId: 'p',
    }),
    resendCode: vi.fn().mockResolvedValue({
      status: 'SENT',
      maskedEmail: 'a***@school.edu',
      expiresAt: new Date(0),
      pendingId: 'p',
    }),
    confirmCode: vi.fn().mockResolvedValue({
      status: 'VERIFIED',
      domain: 'school.edu',
      addRoleIds: [ROLE],
      removeRoleId: null,
    }),
    applyVerified: vi.fn().mockResolvedValue({
      added: [ROLE],
      removed: [],
      refused: [],
      failure: null,
      memberGone: false,
    }),
    ...overrides,
  };
  const config = { get: vi.fn().mockResolvedValue({ verifyMessage: 'Use your school address' }) };
  const locales = { resolve: vi.fn().mockResolvedValue('en') };
  const handlers = new EmailVerifyInteractions(
    verify as unknown as EmailVerifyService,
    config as unknown as EmailVerifyConfigService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (fields: Record<string, string> = {}) => ({
    guildId: null as string | null,
    locale: 'vi',
    user: { id: USER },
    fields: { getTextInputValue: (id: string) => fields[id] ?? '' },
    showModal: vi.fn().mockResolvedValue(undefined),
    deferReply: vi.fn().mockResolvedValue(undefined),
    editReply: vi.fn().mockResolvedValue(undefined),
    replied: false,
    deferred: false,
  });
  return { handlers, verify, config, locales, interaction };
}

const edited = (target: { editReply: { mock: { calls: unknown[][] } } }) =>
  target.editReply.mock.calls[0]?.[0] as {
    content: string;
    components?: Array<{ toJSON(): { components: Array<{ custom_id: string }> } }>;
    allowedMentions?: unknown;
  };

describe('the verify custom ids', () => {
  it('round-trip, stay short and name the server last', () => {
    for (const action of ['start', 'email', 'code', 'resend'] as const) {
      const id = emailVerifyCustomId(action, GUILD);
      expect(id.length).toBeLessThanOrEqual(100);
      expect(parseEmailVerifyCustomId(id)).toEqual({ action, guildId: GUILD });
    }
  });

  it('refuse an id that is not this module’s or names no valid server', () => {
    expect(parseEmailVerifyCustomId('note-add/123')).toBeNull();
    expect(parseEmailVerifyCustomId('ev/start/abc')).toBeNull();
    expect(parseEmailVerifyCustomId('ev/steal/' + GUILD)).toBeNull();
    expect(parseEmailVerifyCustomId(`ev/start/${GUILD}/extra`)).toBeNull();
  });
});

describe('the start button', () => {
  it('opens the address form as the first response, in a direct message too', async () => {
    const { handlers, interaction } = build();
    const target = interaction();
    await handlers.onStart([target] as never, GUILD);

    expect(target.deferReply).not.toHaveBeenCalled();
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON() as unknown as Json;
    expect(modal.custom_id).toBe(`ev/email/${GUILD}`);
    expect(modal.title).toBe(MESSAGES.vi['email-verify'].verify.modal.emailTitle);
    const label = modal.components[0] as { label: string; description?: string };
    expect(label.label).toBe(MESSAGES.vi['email-verify'].verify.modal.emailLabel);
    expect(label.description).toBe('Use your school address');
  });

  it('still opens the form when the server text cannot be read', async () => {
    const { handlers, interaction, config } = build();
    config.get.mockRejectedValue(new Error('db down'));
    const target = interaction();
    await handlers.onStart([target] as never, GUILD);
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON() as unknown as Json;
    expect((modal.components[0] as { description?: string }).description).toBeUndefined();
  });

  it('refuses a server id that is not a snowflake, before answering anything', async () => {
    const { handlers, interaction } = build();
    const target = interaction();
    await expect(handlers.onStart([target] as never, 'abc')).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
    expect(target.showModal).not.toHaveBeenCalled();
  });

  it('cuts a long server text to fit a form label', async () => {
    const { handlers, interaction, config } = build();
    config.get.mockResolvedValue({ verifyMessage: 'x'.repeat(500) });
    const target = interaction();
    await handlers.onStart([target] as never, GUILD);
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON() as unknown as Json;
    expect((modal.components[0] as { description: string }).description.length).toBe(100);
  });
});

describe('the address form', () => {
  it('asks for a code for that server and offers the code and resend buttons', async () => {
    const { handlers, verify, interaction } = build();
    const target = interaction({ email: 'Ann@School.edu' });
    await handlers.onEmailForm([target] as never, GUILD);

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    expect(verify.requestCode).toHaveBeenCalledWith(GUILD, USER, 'Ann@School.edu', 'en');
    const reply = edited(target);
    expect(reply.content).toBe(
      MESSAGES.en['email-verify'].verify.codeSent
        .replace('{email}', 'a***@school.edu')
        .replace('{minutes}', String(EMAIL_CODE_TTL_MINUTES)),
    );
    expect(reply.content).not.toContain('Ann@');
    const row = reply.components?.[0]?.toJSON();
    expect(row?.components.map((button) => button.custom_id)).toEqual([
      `ev/code/${GUILD}`,
      `ev/resend/${GUILD}`,
    ]);
  });

  it('says so when the member is already verified', async () => {
    const { handlers, interaction } = build({
      requestCode: vi.fn().mockResolvedValue({ status: 'ALREADY_VERIFIED', verified: null }),
    });
    const target = interaction({ email: 'a@school.edu' });
    await handlers.onEmailForm([target] as never, GUILD);
    expect(edited(target).content).toBe(MESSAGES.en['email-verify'].verify.alreadyVerified);
  });

  it('gives a verified member the roles they lost and says so', async () => {
    const verified = {
      status: 'VERIFIED',
      domain: 'school.edu',
      addRoleIds: [ROLE],
      removeRoleId: null,
    };
    const { handlers, verify, interaction } = build({
      requestCode: vi.fn().mockResolvedValue({ status: 'ALREADY_VERIFIED', verified }),
    });
    const target = interaction({ email: 'a@school.edu' });
    await handlers.onEmailForm([target] as never, GUILD);
    expect(verify.applyVerified).toHaveBeenCalledWith(GUILD, USER, verified, { rerun: true });
    expect(edited(target).content).toBe(
      MESSAGES.en['email-verify'].verify.verifiedRoles.replace('{roles}', `<@&${ROLE}>`),
    );
  });

  it('lets a refusal reach the exception filter instead of answering it here', async () => {
    const { handlers, interaction } = build({
      requestCode: vi.fn().mockRejectedValue(new ServiceError(ErrorCode.EMAIL_NOT_ACCEPTED)),
    });
    const target = interaction({ email: 'a@other.io' });
    await expect(handlers.onEmailForm([target] as never, GUILD)).rejects.toMatchObject({
      code: ErrorCode.EMAIL_NOT_ACCEPTED,
    });
  });
});

describe('the code form', () => {
  it('opens from the code button', async () => {
    const { handlers, interaction } = build();
    const target = interaction();
    await handlers.onCode([target] as never, GUILD);
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON() as unknown as Json;
    expect(modal.custom_id).toBe(`ev/code/${GUILD}`);
  });

  it('verifies, gives the roles and names them without pinging', async () => {
    const { handlers, verify, interaction } = build();
    const target = interaction({ code: '123456' });
    await handlers.onCodeForm([target] as never, GUILD);

    expect(verify.confirmCode).toHaveBeenCalledWith(GUILD, USER, '123456');
    expect(verify.applyVerified).toHaveBeenCalledWith(
      GUILD,
      USER,
      expect.objectContaining({ status: 'VERIFIED', addRoleIds: [ROLE] }),
    );
    const reply = edited(target);
    expect(reply.content).toBe(
      MESSAGES.en['email-verify'].verify.verifiedRoles.replace('{roles}', `<@&${ROLE}>`),
    );
    expect(reply.allowedMentions).toEqual({ parse: [] });
  });

  it('says plainly that the member is verified when no role comes with it', async () => {
    const { handlers, interaction } = build({
      confirmCode: vi.fn().mockResolvedValue({
        status: 'VERIFIED',
        domain: 'school.edu',
        addRoleIds: [],
        removeRoleId: null,
      }),
    });
    const target = interaction({ code: '123456' });
    await handlers.onCodeForm([target] as never, GUILD);
    expect(edited(target).content).toBe(MESSAGES.en['email-verify'].verify.verified);
  });

  it('reports why the roles could not be given, with Discord’s own words', async () => {
    const { handlers, interaction } = build({
      applyVerified: vi.fn().mockResolvedValue({
        added: [],
        removed: [],
        refused: [ROLE],
        failure: 'Missing Permissions',
        memberGone: false,
      }),
    });
    const target = interaction({ code: '123456' });
    await handlers.onCodeForm([target] as never, GUILD);
    expect(edited(target).content).toContain('Missing Permissions');
  });

  it('tells a member with no verification in progress to start one', async () => {
    const { handlers, verify, interaction } = build({
      confirmCode: vi.fn().mockResolvedValue({ status: 'NO_PENDING' }),
    });
    const target = interaction({ code: '123456' });
    await handlers.onCodeForm([target] as never, GUILD);
    expect(verify.applyVerified).not.toHaveBeenCalled();
    expect(edited(target).content).toBe(MESSAGES.en['email-verify'].verify.notStarted);
  });

  it('answers a member who is already verified without touching roles', async () => {
    const { handlers, verify, interaction } = build({
      confirmCode: vi.fn().mockResolvedValue({ status: 'ALREADY_VERIFIED', verified: null }),
    });
    const target = interaction({ code: '123456' });
    await handlers.onCodeForm([target] as never, GUILD);
    expect(verify.applyVerified).not.toHaveBeenCalled();
    expect(edited(target).content).toBe(MESSAGES.en['email-verify'].verify.alreadyVerified);
  });
});

describe('the resend button', () => {
  it('sends a new code and keeps the buttons', async () => {
    const { handlers, verify, interaction } = build();
    const target = interaction();
    await handlers.onResend([target] as never, GUILD);
    expect(verify.resendCode).toHaveBeenCalledWith(GUILD, USER, 'en');
    expect(edited(target).content).toBe(
      MESSAGES.en['email-verify'].verify.resent.replace('{email}', 'a***@school.edu'),
    );
    expect(edited(target).components).toHaveLength(1);
  });

  it('tells a member with nothing pending to start over', async () => {
    const { handlers, interaction } = build({
      resendCode: vi.fn().mockResolvedValue({ status: 'NO_PENDING' }),
    });
    const target = interaction();
    await handlers.onResend([target] as never, GUILD);
    expect(edited(target).content).toBe(MESSAGES.en['email-verify'].verify.notStarted);
  });
});
