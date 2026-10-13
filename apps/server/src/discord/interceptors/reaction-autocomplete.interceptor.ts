import { Injectable } from '@nestjs/common';
import { parseMessageRef } from '@sab/shared';
import { AutocompleteInterceptor } from 'necord';
import {
  withAutocompleteBudget,
  type AutocompleteInteraction,
} from '../helpers/autocomplete-budget.js';
import { DiscordReactionService } from '../services/discord-reaction.service.js';
import { MessageResolver } from '../services/message-resolver.service.js';

/** The option that carries the message whose reactions are suggested. */
const MESSAGE_LINK_OPTION = 'message-link';
// A choice's name and value are each limited to 100 characters.
const CHOICE_TEXT_MAX = 100;

/**
 * Suggests the emoji that are already on the message named by the command's
 * `message-link` option, with how many reactions each has. The choice value is
 * `emoji.toString()`, the form the reaction commands compare against.
 */
@Injectable()
export class ReactionAutocompleteInterceptor extends AutocompleteInterceptor {
  private readonly answer: (interaction: AutocompleteInteraction) => Promise<void>;

  constructor(resolver: MessageResolver, reactions: DiscordReactionService) {
    super();
    this.answer = withAutocompleteBudget({
      cacheKey: (interaction) => {
        const ref = parseMessageRef(linkOf(interaction), { channelId: channelOf(interaction) });
        return ref.ok ? `message:${ref.messageId}` : undefined;
      },
      load: async (interaction) => {
        const link = linkOf(interaction);
        if (link === '') return [];
        const found = await resolver.fetch(link, { channelId: channelOf(interaction) });
        return found.status === 'OK' ? reactions.listReactions(found.message) : [];
      },
      choices: (summaries, interaction) => {
        const typed = interaction.options.getFocused().trim().toLowerCase();
        return summaries
          .filter((summary) => typed === '' || summary.label.toLowerCase().includes(typed))
          .map((summary) => ({
            name: `${summary.label} (${summary.count})`.slice(0, CHOICE_TEXT_MAX),
            value: summary.emoji.slice(0, CHOICE_TEXT_MAX),
          }));
      },
    });
  }

  async transformOptions(interaction: AutocompleteInteraction): Promise<void> {
    await this.answer(interaction);
  }
}

function linkOf(interaction: AutocompleteInteraction): string {
  return interaction.options.getString(MESSAGE_LINK_OPTION) ?? '';
}

function channelOf(interaction: AutocompleteInteraction): string | undefined {
  return interaction.channelId ?? undefined;
}
