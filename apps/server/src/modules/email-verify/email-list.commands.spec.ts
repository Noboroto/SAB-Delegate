import 'reflect-metadata';
import {
  EMAIL_LISTS_MAX,
  EMAIL_LIST_BATCH_MAX,
  EMAIL_LIST_ENTRIES_MAX,
  MESSAGES,
} from '@sab/shared';
import { describe, expect, it, vi } from 'vitest';
import type * as UploadModule from './email-list-upload.js';
import { EmailListCommands } from './email-list.commands.js';
import type { EmailListService } from './email-list.service.js';
import { GUILD, answers, english, slash } from './email-verify.command-fixtures.js';

const text = MESSAGES.en['email-verify'];
const LIST_ID = '018f0000-0000-7000-8000-000000000001';

const upload = vi.hoisted(() => ({ readUpload: vi.fn() }));
vi.mock('./email-list-upload.js', async (original) => ({
  ...(await original<typeof UploadModule>()),
  readUpload: upload.readUpload,
}));

function build() {
  const lists = {
    list: vi.fn().mockResolvedValue([]),
    create: vi.fn().mockResolvedValue({ name: 'k21' }),
    idOfName: vi.fn().mockResolvedValue(LIST_ID),
    delete: vi.fn().mockResolvedValue({ listName: 'k21', entries: 3 }),
    clearEntries: vi.fn().mockResolvedValue({ listName: 'k21', entries: 3 }),
    addEntries: vi.fn().mockResolvedValue({ changed: 2, skipped: 1, invalid: 0 }),
    removeEntries: vi.fn().mockResolvedValue({ changed: 1, skipped: 0, invalid: 1 }),
  };
  const commands = new EmailListCommands(lists as unknown as EmailListService, english());
  return { commands, lists };
}

const emailsOf = (mock: { mock: { calls: unknown[][] } }, call: number) =>
  (mock.mock.calls[call]?.[2] as { emails: string[] }).emails;

describe('/email-list create and show', () => {
  it('creates a list and says its (normalised) name', async () => {
    const { commands, lists } = build();
    const { target } = slash();
    await commands.onCreate([target] as never, { name: 'K21' });
    expect(lists.create).toHaveBeenCalledWith(GUILD, { name: 'K21' }, expect.anything());
    expect(answers(target)).toEqual([text.list.created.replace('{name}', 'k21')]);
  });

  it('stops at the limit of lists', async () => {
    const { commands, lists } = build();
    lists.list.mockResolvedValue(Array.from({ length: EMAIL_LISTS_MAX }, () => ({})));
    const { target } = slash();
    await commands.onCreate([target] as never, { name: 'one-more' });
    expect(lists.create).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.list.limit.replace('{max}', String(EMAIL_LISTS_MAX))]);
  });

  it('shows the lists with their sizes, never an address', async () => {
    const { commands, lists } = build();
    lists.list.mockResolvedValue([{ name: 'k21', entryCount: 7 }]);
    const { target } = slash();
    await commands.onShow([target] as never);
    expect(answers(target)[0]).toContain(
      text.list.showItem.replace('{name}', 'k21').replace('{count}', '7'),
    );
  });
});

describe('/email-list add and remove', () => {
  it('adds the addresses split at spaces, commas and lines, and reports the counts', async () => {
    const { commands, lists } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, { name: 'k21', emails: 'a@x.io, b@x.io\nc@x.io' });
    expect(lists.idOfName).toHaveBeenCalledWith(GUILD, 'k21');
    expect(emailsOf(lists.addEntries, 0)).toEqual(['a@x.io', 'b@x.io', 'c@x.io']);
    expect(answers(target)).toEqual([
      text.list.added
        .replace('{name}', 'k21')
        .replace('{added}', '2')
        .replace('{skipped}', '1')
        .replace('{invalid}', '0'),
    ]);
  });

  it('removes addresses and reports the counts', async () => {
    const { commands, lists } = build();
    const { target } = slash();
    await commands.onRemove([target] as never, { name: 'k21', emails: 'a@x.io nope' });
    expect(emailsOf(lists.removeEntries, 0)).toEqual(['a@x.io', 'nope']);
    expect(answers(target)).toEqual([
      text.list.removedEntries
        .replace('{name}', 'k21')
        .replace('{removed}', '1')
        .replace('{skipped}', '0')
        .replace('{invalid}', '1'),
    ]);
  });

  it('answers an unknown list through the exception filter, writing nothing', async () => {
    const { commands, lists } = build();
    lists.idOfName.mockRejectedValue(
      Object.assign(new Error('x'), { code: 'EMAIL_LIST_NOT_FOUND' }),
    );
    await expect(
      commands.onAdd([slash().target] as never, { name: 'nope', emails: 'a@x.io' }),
    ).rejects.toMatchObject({ code: 'EMAIL_LIST_NOT_FOUND' });
    expect(lists.addEntries).not.toHaveBeenCalled();
  });
});

describe('/email-list upload', () => {
  const file = {
    url: 'https://cdn.discordapp.com/a/b/c.csv',
    name: 'c.csv',
    size: 10,
    contentType: 'text/csv',
  };

  it('adds the items of the file in batches the service accepts and sums the results', async () => {
    const { commands, lists } = build();
    const items = Array.from({ length: EMAIL_LIST_BATCH_MAX + 10 }, (_, i) => `u${i}@x.io`);
    upload.readUpload.mockResolvedValue({ ok: true, items });
    const { target } = slash();
    await commands.onUpload([target] as never, { name: 'k21', file, mode: undefined });

    expect(lists.addEntries).toHaveBeenCalledTimes(2);
    expect(emailsOf(lists.addEntries, 0)).toHaveLength(EMAIL_LIST_BATCH_MAX);
    expect(emailsOf(lists.addEntries, 1)).toHaveLength(10);
    expect(answers(target)).toEqual([
      text.list.added
        .replace('{name}', 'k21')
        .replace('{added}', '4')
        .replace('{skipped}', '2')
        .replace('{invalid}', '0'),
    ]);
  });

  it('removes with mode remove', async () => {
    const { commands, lists } = build();
    upload.readUpload.mockResolvedValue({ ok: true, items: ['a@x.io'] });
    await commands.onUpload([slash().target] as never, { name: 'k21', file, mode: 'remove' });
    expect(lists.removeEntries).toHaveBeenCalledTimes(1);
    expect(lists.addEntries).not.toHaveBeenCalled();
  });

  it('refuses more addresses than a list can hold, before writing any', async () => {
    const { commands, lists } = build();
    upload.readUpload.mockResolvedValue({
      ok: true,
      items: Array.from({ length: EMAIL_LIST_ENTRIES_MAX + 1 }, (_, i) => `u${i}@x.io`),
    });
    const { target } = slash();
    await commands.onUpload([target] as never, { name: 'k21', file, mode: 'add' });
    expect(lists.addEntries).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([
      text.list.full.replace('{max}', String(EMAIL_LIST_ENTRIES_MAX)),
    ]);
  });

  it.each([
    ['TYPE', text.list.fileType],
    ['TOO_BIG', text.list.fileTooBig.replace('{size}', '1024')],
    ['UNREADABLE', text.list.fileUnreadable],
    ['EMPTY', text.list.fileEmpty],
  ] as const)('says why a file cannot be used (%s)', async (reason, expected) => {
    const { commands, lists } = build();
    upload.readUpload.mockResolvedValue({ ok: false, reason });
    const { target } = slash();
    await commands.onUpload([target] as never, { name: 'k21', file, mode: 'add' });
    expect(answers(target)).toEqual([expected]);
    expect(lists.idOfName).not.toHaveBeenCalled();
  });
});

describe('/email-list delete and clear', () => {
  it('shows what would go, and deletes only after the confirm button', async () => {
    const { commands, lists } = build();
    const { target, click } = slash({ click: 'confirm' });
    await commands.onDelete([target] as never, { name: 'k21' });
    expect(lists.delete).toHaveBeenNthCalledWith(1, GUILD, LIST_ID, expect.anything(), {
      dryRun: true,
    });
    expect(lists.delete).toHaveBeenNthCalledWith(2, GUILD, LIST_ID, expect.anything());
    expect(answers(target)[0]).toBe(
      text.confirm.listDelete
        .replace('{name}', 'k21')
        .replace('{count, plural, one {# address} other {# addresses}}', '3 addresses'),
    );
    expect(click.update).toHaveBeenCalled();
    expect(answers(target).at(-1)).toBe(text.list.deleted.replace('{name}', 'k21'));
  });

  it('deletes nothing when cancelled', async () => {
    const { commands, lists } = build();
    await commands.onDelete([slash({ click: 'cancel' }).target] as never, { name: 'k21' });
    expect(lists.delete).toHaveBeenCalledTimes(1);
  });

  it('clears a list after confirming and keeps it when cancelled', async () => {
    const yes = build();
    const done = slash({ click: 'confirm' });
    await yes.commands.onClear([done.target] as never, { name: 'k21' });
    expect(yes.lists.clearEntries).toHaveBeenCalledTimes(2);
    expect(answers(done.target).at(-1)).toBe(text.list.cleared.replace('{name}', 'k21'));

    const no = build();
    await no.commands.onClear([slash({ click: 'cancel' }).target] as never, { name: 'k21' });
    expect(no.lists.clearEntries).toHaveBeenCalledTimes(1);
  });
});
