import { Injectable } from '@nestjs/common';
import { SnowflakeSchema } from '@sab/shared';
import { AutocompleteInterceptor } from 'necord';
import {
  withAutocompleteBudget,
  type AutocompleteInteraction,
} from '../../discord/helpers/autocomplete-budget.js';
import { NoteService } from './note.service.js';

/** The option whose value names the role the topics belong to. */
const ROLE_OPTION = 'role';

/**
 * Suggests the topics already saved for the role chosen in the same command.
 * Until a role is chosen there is nothing to suggest. The typed text is part of
 * the cache key because the database does the filtering: a topic list for one
 * role is cheap to read, but each keystroke should not read it again.
 */
@Injectable()
export class NoteTopicAutocompleteInterceptor extends AutocompleteInterceptor {
  private readonly answer: (interaction: AutocompleteInteraction) => Promise<void>;

  constructor(notes: NoteService) {
    super();
    this.answer = withAutocompleteBudget({
      cacheKey: (interaction) => {
        const scope = scopeOf(interaction);
        return scope === undefined
          ? undefined
          : `${scope.guildId}:${scope.roleId}:${typedOf(interaction).toLowerCase()}`;
      },
      load: async (interaction) => {
        const scope = scopeOf(interaction);
        if (scope === undefined) return [];
        return notes.listTopics(scope.guildId, scope.roleId, typedOf(interaction));
      },
      choices: (topics) => topics.map((topic) => ({ name: topic, value: topic })),
    });
  }

  async transformOptions(interaction: AutocompleteInteraction): Promise<void> {
    await this.answer(interaction);
  }
}

function typedOf(interaction: AutocompleteInteraction): string {
  return interaction.options.getFocused().trim();
}

function scopeOf(
  interaction: AutocompleteInteraction,
): { guildId: string; roleId: string } | undefined {
  const guildId = SnowflakeSchema.safeParse(interaction.guildId);
  // A role option's raw value is its id; a half-filled command has none yet.
  const roleId = SnowflakeSchema.safeParse(interaction.options.get(ROLE_OPTION)?.value);
  return guildId.success && roleId.success
    ? { guildId: guildId.data, roleId: roleId.data }
    : undefined;
}
