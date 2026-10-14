/** The environment variable the example reads the key from, so the file never holds a secret. */
const MCP_KEY_ENV = 'SAB_MCP_KEY';

export function mcpUrl(origin: string): string {
  return `${origin}/mcp`;
}

/** A `.mcp.json` that expands the key from the environment (`${VAR}` is expanded by the client, not here). */
export function mcpConfigSnippet(origin: string): string {
  return JSON.stringify(
    {
      mcpServers: {
        'sab-delegate': {
          type: 'http',
          url: mcpUrl(origin),
          headers: { Authorization: `Bearer \${${MCP_KEY_ENV}}` },
        },
      },
    },
    null,
    2,
  );
}
