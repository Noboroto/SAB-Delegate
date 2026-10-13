import type { Client } from 'discord.js';
import { describe, expect, it } from 'vitest';
import { SystemService } from './system.service.js';

const clientWith = (state: { uptime: number | null; ping: number; guilds: number }) =>
  ({
    uptime: state.uptime,
    ws: { ping: state.ping },
    guilds: { cache: { size: state.guilds } },
  }) as unknown as Client;

describe('SystemService.getStatus', () => {
  it('reports uptime, websocket ping and guild count', () => {
    const service = new SystemService(clientWith({ uptime: 90_000.7, ping: 42, guilds: 3 }));
    expect(service.getStatus()).toEqual({ uptimeMs: 90_000, wsPing: 42, guildCount: 3 });
  });

  it('reports zero uptime before the session is ready and -1 before the first heartbeat', () => {
    const service = new SystemService(clientWith({ uptime: null, ping: -1, guilds: 0 }));
    expect(service.getStatus()).toEqual({ uptimeMs: 0, wsPing: -1, guildCount: 0 });
  });
});
