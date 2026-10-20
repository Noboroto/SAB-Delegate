import {
  ACCESS_CONDITION_TEXT_MAX,
  ACCESS_RULES_MAX,
  ROLES_MAX,
  parseCondition,
  type AccessCondition,
  type AccessRulesView,
} from '@sab/shared';
import {
  Context,
  IntegerOption,
  RoleOption,
  StringOption,
  Subcommand,
  type SlashCommandContext,
} from 'necord';
import { EmailRuleGroup } from '../../discord/command-groups.js';
import { DiscordCommands } from '../../discord/decorators/discord-commands.decorator.js';
import { Options } from '../../discord/decorators/options.decorator.js';
import { showResult } from '../../discord/helpers/confirm-buttons.js';
import { replyInChunks } from '../../discord/helpers/reply.js';
import { GuildLocaleService } from '../../i18n/guild-locale.service.js';
import { translatorFor } from '../../i18n/translator.js';
import {
  NO_PING,
  PRIVATE,
  actorOf,
  confirmed,
  guildOf,
  optionMeta,
  roleIdsOf,
  roleMentions,
  subcommandMeta,
  type Translate,
} from './email-verify.command-support.js';
import { EmailVerifyConfigService } from './email-verify-config.service.js';

type Ref = { readonly id: string };

class RuleAddOptions {
  @StringOption({
    name: 'expression',
    ...optionMeta('expression'),
    required: true,
    max_length: ACCESS_CONDITION_TEXT_MAX,
  })
  readonly expression!: string;

  @RoleOption({ name: 'role', ...optionMeta('role'), required: true })
  readonly role!: Ref;

  @RoleOption({ name: 'role2', ...optionMeta('role2'), required: false })
  readonly role2?: Ref;

  @RoleOption({ name: 'role3', ...optionMeta('role3'), required: false })
  readonly role3?: Ref;
}

class RuleEditOptions {
  @IntegerOption({
    name: 'index',
    ...optionMeta('index'),
    required: true,
    min_value: 1,
    max_value: ACCESS_RULES_MAX,
  })
  readonly index!: number;

  @StringOption({
    name: 'expression',
    ...optionMeta('expression'),
    required: true,
    max_length: ACCESS_CONDITION_TEXT_MAX,
  })
  readonly expression!: string;
}

class RuleIndexOptions {
  @IntegerOption({
    name: 'index',
    ...optionMeta('index'),
    required: true,
    min_value: 1,
    max_value: ACCESS_RULES_MAX,
  })
  readonly index!: number;
}

class RuleRoleOptions {
  @IntegerOption({
    name: 'index',
    ...optionMeta('index'),
    required: true,
    min_value: 1,
    max_value: ACCESS_RULES_MAX,
  })
  readonly index!: number;

  @RoleOption({ name: 'role', ...optionMeta('role'), required: true })
  readonly role!: Ref;
}

/** The rules as the service takes them back: condition and roles, in order. */
function inputOf(view: AccessRulesView) {
  return {
    rules: view.rules.map((rule) => ({ condition: rule.condition, roleIds: rule.roleIds })),
  };
}

/**
 * Parses the typed condition; the reason and where it went wrong, in the
 * server's language, when it cannot be used.
 */
function parsed(
  t: Translate,
  expression: string,
): { ok: true; condition: AccessCondition } | { ok: false; message: string } {
  const result = parseCondition(expression);
  if (result.ok) return { ok: true, condition: result.condition };
  return {
    ok: false,
    message: t('email-verify.rule.invalid', {
      reason: t(`email-verify.rule.errors.${result.error.code}`),
      position: result.error.position + 1,
    }),
  };
}

/**
 * `/email-rule add|edit|remove|role-add|role-remove|list|clear`. A rule is a
 * condition on the address or the invite and the roles it grants; the rules are
 * numbered as `list` shows them. Who may run them is decided by the group's
 * default permission in Discord; nothing is checked here. Answers are private.
 */
@DiscordCommands()
@EmailRuleGroup()
export class EmailRuleCommands {
  constructor(
    private readonly config: EmailVerifyConfigService,
    private readonly locales: GuildLocaleService,
  ) {}

  @Subcommand(subcommandMeta('emailRule.add', 'add'))
  async onAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { expression, role, role2, role3 }: RuleAddOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const condition = parsed(t, expression);
    if (!condition.ok) return this.say(interaction, condition.message);

    const view = await this.config.rules(guildId);
    if (view.rules.length >= ACCESS_RULES_MAX) {
      return this.say(interaction, t('email-verify.rule.limit', { max: ACCESS_RULES_MAX }));
    }
    const input = inputOf(view);
    input.rules.push({ condition: condition.condition, roleIds: roleIdsOf(role, role2, role3) });
    await this.config.setRules(guildId, input, actorOf(interaction));
    return this.say(interaction, t('email-verify.rule.added', { index: input.rules.length }));
  }

  @Subcommand(subcommandMeta('emailRule.edit', 'edit'))
  async onEdit(
    @Context() [interaction]: SlashCommandContext,
    @Options() { index, expression }: RuleEditOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const condition = parsed(t, expression);
    if (!condition.ok) return this.say(interaction, condition.message);

    const input = inputOf(await this.config.rules(guildId));
    const rule = input.rules[index - 1];
    if (rule === undefined)
      return this.say(interaction, t('email-verify.rule.notFound', { index }));
    rule.condition = condition.condition;
    await this.config.setRules(guildId, input, actorOf(interaction));
    return this.say(interaction, t('email-verify.rule.edited', { index }));
  }

  @Subcommand(subcommandMeta('emailRule.remove', 'remove'))
  async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { index }: RuleIndexOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const input = inputOf(await this.config.rules(guildId));
    if (input.rules[index - 1] === undefined) {
      return this.say(interaction, t('email-verify.rule.notFound', { index }));
    }
    input.rules.splice(index - 1, 1);
    await this.config.setRules(guildId, input, actorOf(interaction));
    return this.say(interaction, t('email-verify.rule.removed', { index }));
  }

  @Subcommand(subcommandMeta('emailRule.roleAdd', 'role-add'))
  async onRoleAdd(
    @Context() [interaction]: SlashCommandContext,
    @Options() { index, role }: RuleRoleOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const input = inputOf(await this.config.rules(guildId));
    const rule = input.rules[index - 1];
    if (rule === undefined)
      return this.say(interaction, t('email-verify.rule.notFound', { index }));
    if (!rule.roleIds.includes(role.id)) {
      if (rule.roleIds.length >= ROLES_MAX) {
        return this.say(interaction, t('email-verify.rule.roleFull', { index, max: ROLES_MAX }));
      }
      rule.roleIds = [...rule.roleIds, role.id];
      await this.config.setRules(guildId, input, actorOf(interaction));
    }
    return this.say(
      interaction,
      t('email-verify.rule.roleAdded', { role: `<@&${role.id}>`, index }),
    );
  }

  @Subcommand(subcommandMeta('emailRule.roleRemove', 'role-remove'))
  async onRoleRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { index, role }: RuleRoleOptions,
  ): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const input = inputOf(await this.config.rules(guildId));
    const rule = input.rules[index - 1];
    if (rule === undefined)
      return this.say(interaction, t('email-verify.rule.notFound', { index }));
    if (rule.roleIds.includes(role.id)) {
      rule.roleIds = rule.roleIds.filter((id) => id !== role.id);
      await this.config.setRules(guildId, input, actorOf(interaction));
    }
    return this.say(
      interaction,
      t('email-verify.rule.roleRemoved', { role: `<@&${role.id}>`, index }),
    );
  }

  @Subcommand(subcommandMeta('emailRule.list', 'list'))
  async onList(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { rules } = await this.config.rules(guildId);
    if (rules.length === 0) return this.say(interaction, t('email-verify.rule.listEmpty'));

    const lines = [`**${t('email-verify.rule.listTitle')}**`];
    rules.forEach((rule, position) => {
      lines.push(
        t('email-verify.rule.listItem', {
          index: position + 1,
          text: rule.text,
          roles: roleMentions(rule.roleIds, t('email-verify.rule.noRoles')),
        }),
      );
      if (rule.missingLists.length > 0) {
        lines.push(t('email-verify.rule.missingLists', { names: rule.missingLists.join(', ') }));
      }
    });
    await replyInChunks(interaction, lines.join('\n'), {
      ephemeral: true,
      allowedMentions: NO_PING,
    });
  }

  @Subcommand(subcommandMeta('emailRule.clear', 'clear'))
  async onClear(@Context() [interaction]: SlashCommandContext): Promise<void> {
    const guildId = guildOf(interaction);
    await interaction.deferReply({ flags: PRIVATE });
    const t = translatorFor(await this.locales.resolve(guildId, interaction));
    const { rules } = await this.config.rules(guildId);
    if (rules.length === 0) {
      await showResult(interaction, t('email-verify.rule.listEmpty'));
      return;
    }
    const prompt = t('email-verify.confirm.ruleClear', { count: rules.length });
    if (!(await confirmed(interaction, t, prompt))) return;

    await this.config.setRules(guildId, { rules: [] }, actorOf(interaction));
    await showResult(interaction, t('email-verify.rule.cleared'));
  }

  private async say(interaction: Parameters<typeof replyInChunks>[0], text: string): Promise<void> {
    await replyInChunks(interaction, text, { ephemeral: true, allowedMentions: NO_PING });
  }
}
