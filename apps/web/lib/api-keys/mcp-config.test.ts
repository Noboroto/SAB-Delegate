import { describe, expect, it } from 'vitest';
import { mcpConfigSnippet, mcpUrl } from './mcp-config';

describe('mcpConfigSnippet', () => {
  it('points at the /mcp path of the origin and reads the key from the environment', () => {
    const snippet = mcpConfigSnippet('https://bot.example.com');
    expect(mcpUrl('https://bot.example.com')).toBe('https://bot.example.com/mcp');
    expect(JSON.parse(snippet)).toEqual({
      mcpServers: {
        'sab-delegate': {
          type: 'http',
          url: 'https://bot.example.com/mcp',
          headers: { Authorization: 'Bearer ${SAB_MCP_KEY}' },
        },
      },
    });
  });
});
