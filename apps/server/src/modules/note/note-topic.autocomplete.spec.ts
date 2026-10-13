import 'reflect-metadata';
import { describe, expect, it, vi } from 'vitest';
import type { AutocompleteInteraction } from '../../discord/helpers/autocomplete-budget.js';
import { NoteTopicAutocompleteInterceptor } from './note-topic.autocomplete.js';
import type { NoteService } from './note.service.js';

const GUILD = '100000000000000001';
const ROLE = '300000000000000001';

function build(topics: string[] = ['Rules', 'Links']) {
  const listTopics = vi.fn().mockResolvedValue(topics);
  const interceptor = new NoteTopicAutocompleteInterceptor({
    listTopics,
  } as unknown as NoteService);
  const interaction = (
    options: { role?: unknown; typed?: string; guildId?: string | null } = {},
  ) => {
    // A destructuring default would also replace an explicit `undefined`.
    const role = 'role' in options ? options.role : ROLE;
    const { typed = '', guildId = GUILD } = options;
    const respond = vi.fn().mockResolvedValue(undefined);
    const target = {
      guildId,
      respond,
      options: {
        get: vi.fn((name: string) =>
          name === 'role' && role !== undefined ? { value: role } : null,
        ),
        getFocused: vi.fn(() => typed),
      },
    };
    return { target: target as unknown as AutocompleteInteraction, respond };
  };
  return { interceptor, listTopics, interaction };
}

describe('NoteTopicAutocompleteInterceptor', () => {
  it('suggests the topics of the role chosen in the same command', async () => {
    const { interceptor, listTopics, interaction } = build();
    const { target, respond } = interaction({ typed: ' ru' });
    await interceptor.transformOptions(target);

    expect(listTopics).toHaveBeenCalledWith(GUILD, ROLE, 'ru');
    expect(respond).toHaveBeenCalledWith([
      { name: 'Rules', value: 'Rules' },
      { name: 'Links', value: 'Links' },
    ]);
  });

  it('never answers with more than 25 suggestions', async () => {
    const many = Array.from({ length: 40 }, (_, index) => `topic ${index}`);
    const { interceptor, interaction } = build(many);
    const { target, respond } = interaction();
    await interceptor.transformOptions(target);
    expect(respond.mock.calls[0]?.[0]).toHaveLength(25);
  });

  it('suggests nothing, and reads nothing, until a role is chosen', async () => {
    const { interceptor, listTopics, interaction } = build();
    for (const role of [undefined, '', 'not-a-snowflake', 42]) {
      const { target, respond } = interaction({ role });
      await interceptor.transformOptions(target);
      expect(respond).toHaveBeenCalledWith([]);
    }
    expect(listTopics).not.toHaveBeenCalled();
  });

  it('suggests nothing outside a server', async () => {
    const { interceptor, listTopics, interaction } = build();
    const { target, respond } = interaction({ guildId: null });
    await interceptor.transformOptions(target);
    expect(respond).toHaveBeenCalledWith([]);
    expect(listTopics).not.toHaveBeenCalled();
  });

  it('reads the topics once for repeated identical input and again when the text changes', async () => {
    const { interceptor, listTopics, interaction } = build();
    await interceptor.transformOptions(interaction({ typed: 'ru' }).target);
    await interceptor.transformOptions(interaction({ typed: 'RU' }).target);
    expect(listTopics).toHaveBeenCalledTimes(1);

    await interceptor.transformOptions(interaction({ typed: 'rul' }).target);
    expect(listTopics).toHaveBeenCalledTimes(2);
  });

  it('keeps the roles apart in the cache', async () => {
    const { interceptor, listTopics, interaction } = build();
    await interceptor.transformOptions(interaction({ role: ROLE }).target);
    await interceptor.transformOptions(interaction({ role: '300000000000000002' }).target);
    expect(listTopics).toHaveBeenCalledTimes(2);
  });
});
