import 'reflect-metadata';
import { ErrorCode, MESSAGES } from '@sab/shared';
import { TextInputStyle, type ModalBuilder } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { ServiceError } from '../../common/errors/service-error.js';
import type { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { NoteCommands } from './note.commands.js';
import type { NoteService } from './note.service.js';

const GUILD = '100000000000000001';
const USER = '100000000000000002';
const ROLE = { id: '300000000000000001', name: 'Mentors' };

function build(locale: 'vi' | 'en' = 'en') {
  const calls: string[] = [];
  const notes = {
    upsert: vi.fn().mockImplementation((_guild: string, input: { topic: string }) => {
      calls.push('upsert');
      return Promise.resolve({ ...input, updatedAt: new Date(0) });
    }),
    remove: vi.fn().mockImplementation(() => {
      calls.push('remove');
      return Promise.resolve({ count: 1 });
    }),
    listByRole: vi.fn().mockResolvedValue([]),
  };
  const locales = { resolve: vi.fn().mockResolvedValue(locale) };
  const commands = new NoteCommands(
    notes as unknown as NoteService,
    locales as unknown as GuildLocaleService,
  );
  const interaction = (guildId: string | null = GUILD) => {
    const target = {
      guildId,
      locale: 'vi',
      user: { id: USER },
      replied: false,
      deferred: false,
      guild: { roles: { cache: new Map([[ROLE.id, ROLE]]) } },
      fields: { getTextInputValue: vi.fn() },
      reply: vi.fn().mockResolvedValue(undefined),
      showModal: vi.fn().mockImplementation(() => {
        calls.push('showModal');
        return Promise.resolve();
      }),
      deferReply: vi.fn().mockImplementation(() => {
        calls.push('deferReply');
        target.deferred = true;
        return Promise.resolve();
      }),
      editReply: vi.fn().mockImplementation(() => {
        calls.push('editReply');
        return Promise.resolve();
      }),
      followUp: vi.fn().mockResolvedValue(undefined),
    };
    return target;
  };
  return { commands, notes, locales, interaction, calls };
}

const textOf = (mock: { mock: { calls: unknown[][] } }, call = 0) =>
  (mock.mock.calls[call]?.[0] as { content: string }).content;

type Input = {
  custom_id: string;
  style: TextInputStyle;
  value?: string;
  required?: boolean;
  max_length?: number;
};

describe('/note add', () => {
  it('opens a dialog as the first and only response when the content is missing', async () => {
    const { commands, notes, interaction, calls } = build();
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: 'Rules' });

    expect(calls).toEqual(['showModal']);
    expect(target.deferReply).not.toHaveBeenCalled();
    expect(target.reply).not.toHaveBeenCalled();
    expect(notes.upsert).not.toHaveBeenCalled();
  });

  it('puts the role in the dialog id and asks for the topic and a paragraph of content', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: '  Rules ' });

    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();
    expect(modal.custom_id).toBe(`note-add/${ROLE.id}`);
    expect(modal.custom_id.length).toBeLessThanOrEqual(100);
    const labels = modal.components as unknown as Array<{ label: string; component: Input }>;
    const inputs = labels.map((entry) => entry.component);
    expect(labels.map((entry) => entry.label)).toEqual([
      MESSAGES.vi.note.modal.topicLabel,
      MESSAGES.vi.note.modal.contentLabel,
    ]);
    expect(inputs.map((input) => input.custom_id)).toEqual(['topic', 'content']);
    expect(inputs[0]).toMatchObject({
      style: TextInputStyle.Short,
      value: 'Rules',
      required: true,
    });
    expect(inputs[1]).toMatchObject({ style: TextInputStyle.Paragraph, required: true });
    expect(inputs[1]?.max_length).toBeLessThanOrEqual(4000);
  });

  it('words the dialog in the language of the person who ran the command', async () => {
    const { commands, interaction } = build('en');
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: 't' });
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();
    // The interaction's locale is Vietnamese; the server's stored language is not consulted.
    expect(modal.title).toBe(MESSAGES.vi.note.modal.title);
  });

  it('leaves the topic field empty rather than unsubmittable when the topic was only spaces', async () => {
    const { commands, interaction } = build();
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: '   ' });
    const modal = (target.showModal.mock.calls[0] as [ModalBuilder])[0].toJSON();
    const [first] = modal.components as unknown as Array<{ component: Input }>;
    expect(first?.component.value).toBeUndefined();
  });

  it('defers publicly, saves as the person who ran it, then edits the answer in', async () => {
    const { commands, notes, interaction, calls } = build('en');
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: 'Rules', content: 'Be kind' });

    expect(calls).toEqual(['deferReply', 'upsert', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith();
    expect(notes.upsert).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, topic: 'Rules', content: 'Be kind' },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe('Saved the note for @Mentors with topic Rules.');
    expect(target.showModal).not.toHaveBeenCalled();
  });

  it('answers in the server language', async () => {
    const { commands, interaction } = build('vi');
    const target = interaction();
    await commands.onAdd([target] as never, { role: ROLE, topic: 'Rules', content: 'x' });
    expect(textOf(target.editReply)).toBe('Đã lưu ghi chú cho @Mentors với chủ đề Rules.');
  });

  it('lets a refusal of blank content through to the exception filter, saving nothing', async () => {
    const { commands, notes, interaction } = build();
    notes.upsert.mockRejectedValue(new ServiceError(ErrorCode.VALIDATION_FAILED));
    const target = interaction();
    await expect(
      commands.onAdd([target] as never, { role: ROLE, topic: 'Rules', content: '   ' }),
    ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
    expect(target.editReply).not.toHaveBeenCalled();
  });

  it('refuses outside a server without opening a dialog', async () => {
    const { commands, interaction } = build();
    const target = interaction(null);
    await expect(
      commands.onAdd([target] as never, { role: ROLE, topic: 't' }),
    ).rejects.toMatchObject({
      code: ErrorCode.GUILD_NOT_FOUND,
    });
    expect(target.showModal).not.toHaveBeenCalled();
  });
});

describe('the /note add dialog', () => {
  const submit = (fields: { topic: string; content: string }) => {
    const harness = build('en');
    const target = harness.interaction();
    target.fields.getTextInputValue.mockImplementation((id: 'topic' | 'content') => fields[id]);
    return { ...harness, target };
  };

  it('saves what was typed against the role named in the dialog id, publicly', async () => {
    const { commands, notes, target, calls } = submit({ topic: 'Rules', content: 'Be kind' });
    await commands.onAddModal([target] as never, ROLE.id);

    expect(calls).toEqual(['deferReply', 'upsert', 'editReply']);
    expect(target.deferReply).toHaveBeenCalledWith();
    expect(notes.upsert).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, topic: 'Rules', content: 'Be kind' },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toContain('@Mentors');
  });

  it('names the role by id when it is no longer in the server', async () => {
    const { commands, target } = submit({ topic: 'Rules', content: 'x' });
    await commands.onAddModal([target] as never, '300000000000000099');
    expect(textOf(target.editReply)).toContain('@300000000000000099');
  });

  it('passes blank text on for the service to refuse', async () => {
    const { commands, notes, target } = submit({ topic: 'Rules', content: '   ' });
    notes.upsert.mockRejectedValue(new ServiceError(ErrorCode.VALIDATION_FAILED));
    await expect(commands.onAddModal([target] as never, ROLE.id)).rejects.toMatchObject({
      code: ErrorCode.VALIDATION_FAILED,
    });
  });
});

describe('/note get', () => {
  it('prints the role as pretty JSON of topic to text, publicly', async () => {
    const { commands, notes, interaction } = build('en');
    notes.listByRole.mockResolvedValue([
      { topic: 'Rules', content: 'Be kind' },
      { topic: 'Links', content: 'line 1\nline 2' },
    ]);
    const target = interaction();
    await commands.onGet([target] as never, { role: ROLE });

    expect(target.deferReply).toHaveBeenCalledWith();
    expect(notes.listByRole).toHaveBeenCalledWith(GUILD, ROLE.id);
    expect(textOf(target.editReply)).toBe(
      `Notes for @Mentors:\n${JSON.stringify({ Rules: 'Be kind', Links: 'line 1\nline 2' }, null, 2)}`,
    );
  });

  it('prints an empty object for a role without notes', async () => {
    const { commands, interaction } = build('en');
    const target = interaction();
    await commands.onGet([target] as never, { role: ROLE });
    expect(textOf(target.editReply)).toBe('Notes for @Mentors:\n{}');
  });

  it('keeps a topic named like an object builtin as an ordinary key', async () => {
    const { commands, notes, interaction } = build('en');
    notes.listByRole.mockResolvedValue([{ topic: '__proto__', content: 'x' }]);
    const target = interaction();
    await commands.onGet([target] as never, { role: ROLE });
    expect(textOf(target.editReply)).toContain('"__proto__": "x"');
  });

  it('splits an answer past 2000 characters into messages that each fit', async () => {
    const { commands, notes, interaction } = build('en');
    notes.listByRole.mockResolvedValue([
      { topic: 'A', content: 'a'.repeat(1500) },
      { topic: 'B', content: 'b'.repeat(1500) },
    ]);
    const target = interaction();
    await commands.onGet([target] as never, { role: ROLE });

    const sent = [
      ...target.editReply.mock.calls.map(([options]) => (options as { content: string }).content),
      ...target.followUp.mock.calls.map(([options]) => (options as { content: string }).content),
    ];
    expect(sent.length).toBeGreaterThanOrEqual(2);
    for (const piece of sent) expect(piece.length).toBeLessThanOrEqual(2000);
    expect(sent.join('\n')).toContain('a'.repeat(1500));
    expect(sent.join('\n')).toContain('b'.repeat(1500));
  });
});

describe('/note remove', () => {
  it('removes by role and exact topic and confirms publicly', async () => {
    const { commands, notes, interaction, calls } = build('en');
    const target = interaction();
    await commands.onRemove([target] as never, { role: ROLE, topic: 'Rules' });

    expect(calls).toEqual(['deferReply', 'remove', 'editReply']);
    expect(notes.remove).toHaveBeenCalledWith(
      GUILD,
      { roleId: ROLE.id, topic: 'Rules' },
      { source: 'DISCORD', userId: USER },
    );
    expect(textOf(target.editReply)).toBe('Removed the note of @Mentors with topic Rules.');
  });

  it('confirms the same way when the topic did not exist', async () => {
    const { commands, notes, interaction } = build('en');
    notes.remove.mockResolvedValue({ count: 0 });
    const target = interaction();
    await commands.onRemove([target] as never, { role: ROLE, topic: 'Missing' });
    expect(textOf(target.editReply)).toBe('Removed the note of @Mentors with topic Missing.');
  });

  it('refuses outside a server', async () => {
    const { commands, notes, interaction } = build();
    await expect(
      commands.onRemove([interaction(null)] as never, { role: ROLE, topic: 't' }),
    ).rejects.toMatchObject({ code: ErrorCode.GUILD_NOT_FOUND });
    expect(notes.remove).not.toHaveBeenCalled();
  });
});
