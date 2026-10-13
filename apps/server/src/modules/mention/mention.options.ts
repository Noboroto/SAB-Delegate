import {
  MENTION_CONTENT_MAX_LENGTH,
  REACTION_EMOJI_MAX_LENGTH,
  MENTION_EVERYONE_CONTENT_MAX_LENGTH,
} from '@sab/shared';
import { BooleanOption, RoleOption, StringOption } from 'necord';
import { localizations } from '../../i18n/localizations.js';

const messageLinkText = localizations('mention.commands.messageLinkOption.description');
const emojiText = localizations('mention.commands.emojiOption.description');
const replyMessageText = localizations('mention.commands.replyMessageOption.description');
const contentText = localizations('mention.commands.contentOption.description');
const everyoneContentText = localizations('mention.commands.everyoneContentOption.description');
const roleText = localizations('mention.commands.roleOption.description');
const isReplyText = localizations('mention.commands.isReplyOption.description');
const includeBotsText = localizations('mention.commands.includeBotsOption.description');
const onlyInChannelText = localizations('mention.commands.onlyInChannelOption.description');

/** The option the emoji suggestions read the message from; see `ReactionAutocompleteInterceptor`. */
export class ByReactionOptions {
  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'emoji',
    description: emojiText['en-US'],
    description_localizations: emojiText,
    required: true,
    autocomplete: true,
    max_length: REACTION_EMOJI_MAX_LENGTH,
  })
  readonly emoji!: string;

  @StringOption({
    name: 'reply-message',
    description: replyMessageText['en-US'],
    description_localizations: replyMessageText,
    required: false,
  })
  readonly replyMessage?: string;

  @StringOption({
    name: 'content',
    description: contentText['en-US'],
    description_localizations: contentText,
    required: false,
    max_length: MENTION_CONTENT_MAX_LENGTH,
  })
  readonly content?: string;
}

export class NotReactOptions {
  @StringOption({
    name: 'message-link',
    description: messageLinkText['en-US'],
    description_localizations: messageLinkText,
    required: true,
  })
  readonly messageLink!: string;

  @StringOption({
    name: 'content',
    description: contentText['en-US'],
    description_localizations: contentText,
    required: false,
    max_length: MENTION_CONTENT_MAX_LENGTH,
  })
  readonly content?: string;

  @RoleOption({
    name: 'role',
    description: roleText['en-US'],
    description_localizations: roleText,
    required: false,
  })
  readonly role?: { readonly id: string };

  @BooleanOption({
    name: 'is-reply',
    description: isReplyText['en-US'],
    description_localizations: isReplyText,
    required: false,
  })
  readonly isReply?: boolean;

  @BooleanOption({
    name: 'include-bots',
    description: includeBotsText['en-US'],
    description_localizations: includeBotsText,
    required: false,
  })
  readonly includeBots?: boolean;

  @BooleanOption({
    name: 'only-in-channel',
    description: onlyInChannelText['en-US'],
    description_localizations: onlyInChannelText,
    required: false,
  })
  readonly onlyInChannel?: boolean;
}

/** Shared by `/mention everyone` and `/thread everyone`, which are the same command. */
export class EveryoneOptions {
  @StringOption({
    name: 'content',
    description: everyoneContentText['en-US'],
    description_localizations: everyoneContentText,
    required: false,
    max_length: MENTION_EVERYONE_CONTENT_MAX_LENGTH,
  })
  readonly content?: string;

  @StringOption({
    name: 'reply-message',
    description: replyMessageText['en-US'],
    description_localizations: replyMessageText,
    required: false,
  })
  readonly replyMessage?: string;
}
