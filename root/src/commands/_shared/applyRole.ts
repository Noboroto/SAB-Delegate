import { ChatInputCommandInteraction, Role } from "discord.js";
import { errorMessage } from "./errorMessage";

export type ApplyRoleResult = {
  done: number;
  /** Human-readable lines for members whose role change failed. */
  failures: string[];
};

/**
 * Adds or removes `role` for each id one at a time (parallel role edits hit
 * rate limits and one failure would hide the others). Ids that are not members
 * of the guild are skipped. Only successes are counted.
 */
export const applyRoleToMembers = async (
  interaction: ChatInputCommandInteraction,
  ids: string[],
  role: Role,
  isRemove: boolean
): Promise<ApplyRoleResult> => {
  // The cache only holds members seen so far; the full list needs a fetch.
  const members = await interaction.guild.members.fetch();
  const result: ApplyRoleResult = { done: 0, failures: [] };

  for (const id of ids) {
    const member = members.get(id);
    if (!member) continue;
    try {
      if (isRemove) await member.roles.remove(role);
      else await member.roles.add(role);
      result.done++;
    } catch (error) {
      console.error(`Error modifying role of ${member.user.username}`, error);
      result.failures.push(`${member.user.username}: ${errorMessage(error)}`);
    }
  }
  return result;
};

export const describeFailures = (failures: string[]): string =>
  failures.length ? `\nFailed ${failures.length}:\n${failures.join("\n")}` : "";
