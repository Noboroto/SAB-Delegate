import 'reflect-metadata';
import { ACCESS_RULES_MAX, MESSAGES, parseCondition, type AccessCondition } from '@sab/shared';
import { MessageFlags } from 'discord.js';
import { describe, expect, it, vi } from 'vitest';
import { EmailRuleCommands } from './email-rule.commands.js';
import type { EmailVerifyConfigService } from './email-verify-config.service.js';
import {
  GUILD,
  ROLE_A,
  ROLE_B,
  USER,
  answers,
  english,
  slash,
} from './email-verify.command-fixtures.js';

const text = MESSAGES.en['email-verify'];

function conditionOf(expression: string): AccessCondition {
  const parsed = parseCondition(expression);
  if (!parsed.ok) throw new Error(`bad fixture ${expression}`);
  return parsed.condition;
}

function ruleView(expression: string, roleIds: string[], missingLists: string[] = []) {
  const condition = conditionOf(expression);
  return { condition, roleIds, text: expression, missingLists };
}

function build(rules = [ruleView('domain:*.edu', [ROLE_A])]) {
  const config = {
    rules: vi.fn().mockResolvedValue({ rules }),
    setRules: vi.fn().mockResolvedValue({ rules }),
  };
  const commands = new EmailRuleCommands(config as unknown as EmailVerifyConfigService, english());
  return { commands, config };
}

describe('/email-rule add', () => {
  it('adds the parsed condition with up to three roles, once, and answers privately', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, {
      expression: 'domain:*.edu AND (list:k21 OR invite:abc12)',
      role: { id: ROLE_A },
      role2: { id: ROLE_B },
      role3: { id: ROLE_A },
    });

    expect(target.deferReply).toHaveBeenCalledWith({ flags: MessageFlags.Ephemeral });
    const [guild, input, actor] = config.setRules.mock.calls[0] as [
      string,
      { rules: Array<{ condition: AccessCondition; roleIds: string[] }> },
      { userId: string },
    ];
    expect(guild).toBe(GUILD);
    expect(actor.userId).toBe(USER);
    expect(input.rules).toHaveLength(2);
    expect(input.rules[0]?.roleIds).toEqual([ROLE_A]);
    expect(input.rules[1]?.roleIds).toEqual([ROLE_A, ROLE_B]);
    expect(input.rules[1]?.condition).toEqual(
      conditionOf('domain:*.edu AND (list:k21 OR invite:abc12)'),
    );
    expect(answers(target)).toEqual([text.rule.added.replace('{index}', '2')]);
  });

  it('says what is wrong and where, and changes nothing', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, {
      expression: 'domain:*.edu AND',
      role: { id: ROLE_A },
    });
    const result = parseCondition('domain:*.edu AND');
    if (result.ok) throw new Error('expected a parse failure');
    expect(config.setRules).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([
      text.rule.invalid
        .replace('{reason}', text.rule.errors[result.error.code])
        .replace('{position}', String(result.error.position + 1)),
    ]);
  });

  it('refuses a field it does not know', async () => {
    const { commands, config } = build();
    const { target } = slash();
    await commands.onAdd([target] as never, { expression: 'color:red', role: { id: ROLE_A } });
    expect(config.setRules).not.toHaveBeenCalled();
    expect(answers(target)[0]).toContain(text.rule.errors.UNKNOWN_FIELD);
  });

  it('stops at the rule limit', async () => {
    const full = Array.from({ length: ACCESS_RULES_MAX }, () => ruleView('domain:a.io', []));
    const { commands, config } = build(full);
    const { target } = slash();
    await commands.onAdd([target] as never, { expression: 'domain:b.io', role: { id: ROLE_A } });
    expect(config.setRules).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([text.rule.limit.replace('{max}', String(ACCESS_RULES_MAX))]);
  });

  it('is refused outside a server', async () => {
    const { commands } = build();
    const { target } = slash({ guildId: null });
    await expect(
      commands.onAdd([target] as never, { expression: 'domain:a.io', role: { id: ROLE_A } }),
    ).rejects.toMatchObject({ code: 'GUILD_NOT_FOUND' });
  });
});

describe('/email-rule edit', () => {
  it('replaces only the condition of the numbered rule', async () => {
    const { commands, config } = build([
      ruleView('domain:a.io', [ROLE_A]),
      ruleView('domain:b.io', [ROLE_B]),
    ]);
    const { target } = slash();
    await commands.onEdit([target] as never, { index: 2, expression: 'email:*@c.io' });
    const input = config.setRules.mock.calls[0]?.[1] as {
      rules: Array<{ condition: AccessCondition; roleIds: string[] }>;
    };
    expect(input.rules[0]?.condition).toEqual(conditionOf('domain:a.io'));
    expect(input.rules[1]).toEqual({ condition: conditionOf('email:*@c.io'), roleIds: [ROLE_B] });
    expect(answers(target)).toEqual([text.rule.edited.replace('{index}', '2')]);
  });

  it('says so when there is no such rule, and when the new condition is invalid', async () => {
    const { commands, config } = build();
    const missing = slash();
    await commands.onEdit([missing.target] as never, { index: 5, expression: 'domain:a.io' });
    expect(answers(missing.target)).toEqual([text.rule.notFound.replace('{index}', '5')]);

    const invalid = slash();
    await commands.onEdit([invalid.target] as never, { index: 1, expression: '((' });
    expect(answers(invalid.target)[0]).toContain('(at position');
    expect(config.setRules).not.toHaveBeenCalled();
  });
});

describe('/email-rule remove, role-add and role-remove', () => {
  it('removes the numbered rule and keeps the others in order', async () => {
    const { commands, config } = build([ruleView('domain:a.io', []), ruleView('domain:b.io', [])]);
    const { target } = slash();
    await commands.onRemove([target] as never, { index: 1 });
    const input = config.setRules.mock.calls[0]?.[1] as { rules: Array<{ condition: unknown }> };
    expect(input.rules).toEqual([{ condition: conditionOf('domain:b.io'), roleIds: [] }]);
  });

  it('adds a role once and removes it again', async () => {
    const { commands, config } = build();
    await commands.onRoleAdd([slash().target] as never, { index: 1, role: { id: ROLE_A } });
    expect(config.setRules).not.toHaveBeenCalled();

    await commands.onRoleAdd([slash().target] as never, { index: 1, role: { id: ROLE_B } });
    expect(
      (config.setRules.mock.calls[0]?.[1] as { rules: Array<{ roleIds: string[] }> }).rules[0]
        ?.roleIds,
    ).toEqual([ROLE_A, ROLE_B]);

    await commands.onRoleRemove([slash().target] as never, { index: 1, role: { id: ROLE_A } });
    expect(
      (config.setRules.mock.calls[1]?.[1] as { rules: Array<{ roleIds: string[] }> }).rules[0]
        ?.roleIds,
    ).toEqual([]);
  });

  it('refuses a rule with too many roles', async () => {
    const roles = Array.from(
      { length: 25 },
      (_, i) => `4000000000000000${String(i).padStart(2, '0')}`,
    );
    const { commands, config } = build([ruleView('domain:a.io', roles)]);
    const { target } = slash();
    await commands.onRoleAdd([target] as never, { index: 1, role: { id: ROLE_B } });
    expect(config.setRules).not.toHaveBeenCalled();
    expect(answers(target)).toEqual([
      text.rule.roleFull.replace('{index}', '1').replace('{max}', '25'),
    ]);
  });
});

describe('/email-rule list', () => {
  it('shows each rule as text with its roles as mentions that ping nobody', async () => {
    const { commands } = build([
      ruleView('domain:*.edu', [ROLE_A, ROLE_B]),
      ruleView('list:ghost', [], ['ghost']),
    ]);
    const { target } = slash();
    await commands.onList([target] as never);
    const [content] = answers(target);
    expect(content).toContain(`**1.** \`domain:*.edu\` gives <@&${ROLE_A}> <@&${ROLE_B}>`);
    expect(content).toContain(`**2.** \`list:ghost\` gives ${text.rule.noRoles}`);
    expect(content).toContain(text.rule.missingLists.replace('{names}', 'ghost'));
    expect(target.editReply.mock.calls[0]?.[0]).toMatchObject({ allowedMentions: { parse: [] } });
  });

  it('splits a long list into messages of at most 2000 characters', async () => {
    const many = Array.from({ length: ACCESS_RULES_MAX }, () =>
      ruleView(
        `email:${'a'.repeat(120)}@x.io`,
        Array.from({ length: 25 }, () => ROLE_A),
      ),
    );
    const { commands } = build(many);
    const { target } = slash();
    await commands.onList([target] as never);
    const sent = [
      ...answers(target),
      ...target.followUp.mock.calls.map((call) => (call[0] as { content: string }).content),
    ];
    expect(sent.length).toBeGreaterThan(1);
    for (const piece of sent) expect(piece.length).toBeLessThanOrEqual(2000);
  });

  it('says there are no rules', async () => {
    const { commands } = build([]);
    const { target } = slash();
    await commands.onList([target] as never);
    expect(answers(target)).toEqual([text.rule.listEmpty]);
  });
});

describe('/email-rule clear', () => {
  it('asks first and clears only after the confirm button', async () => {
    const { commands, config } = build();
    const { target, click } = slash({ click: 'confirm' });
    await commands.onClear([target] as never);
    expect(config.setRules).toHaveBeenCalledWith(GUILD, { rules: [] }, expect.any(Object));
    expect(click.update).toHaveBeenCalled();
    expect(answers(target).at(-1)).toBe(text.rule.cleared);
  });

  it('keeps the rules when cancelled', async () => {
    const { commands, config } = build();
    const { target } = slash({ click: 'cancel' });
    await commands.onClear([target] as never);
    expect(config.setRules).not.toHaveBeenCalled();
  });

  it('does not ask when there is nothing to clear', async () => {
    const { commands, config } = build([]);
    const { target, prompt } = slash();
    await commands.onClear([target] as never);
    expect(prompt.awaitMessageComponent).not.toHaveBeenCalled();
    expect(config.setRules).not.toHaveBeenCalled();
  });
});
