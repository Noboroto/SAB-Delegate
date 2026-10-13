import { Injectable } from '@nestjs/common';
import { z } from '@sab/shared';
import { Client } from 'discord.js';

const SystemStatusSchema = z.object({
  /** Milliseconds since the gateway session became ready; 0 before that. */
  uptimeMs: z.number().int().nonnegative(),
  /** Websocket heartbeat in milliseconds; -1 until the first heartbeat is acknowledged. */
  wsPing: z.number().int().min(-1),
  guildCount: z.number().int().nonnegative(),
});

export type SystemStatus = z.infer<typeof SystemStatusSchema>;

/** What the bot reports about itself. Reads the live client; touches no database. */
@Injectable()
export class SystemService {
  constructor(private readonly client: Client) {}

  getStatus(): SystemStatus {
    return SystemStatusSchema.parse({
      uptimeMs: Math.max(0, Math.trunc(this.client.uptime ?? 0)),
      wsPing: Math.trunc(this.client.ws.ping),
      guildCount: this.client.guilds.cache.size,
    });
  }
}
