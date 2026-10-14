/** Discord's CDN address of a server icon from the hash the server returns; `undefined` for a server with none. */
export function guildIconUrl(guildId: string, icon: string | null, size = 64): string | undefined {
  if (icon === null || !/^[a-z0-9_]+$/i.test(icon)) return undefined;
  return `https://cdn.discordapp.com/icons/${guildId}/${icon}.png?size=${size}`;
}
