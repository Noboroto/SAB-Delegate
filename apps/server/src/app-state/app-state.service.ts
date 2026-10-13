import { Injectable, Module } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Small string key/value store in Postgres, for facts the process must carry
 * across restarts (such as the hash of the slash-command payload it last
 * registered).
 */
@Injectable()
export class AppStateService {
  constructor(private readonly prisma: PrismaService) {}

  async get(key: string): Promise<string | null> {
    requireKey(key);
    const row = await this.prisma.appState.findUnique({
      where: { key },
      select: { value: true },
    });
    return row?.value ?? null;
  }

  /** One row per key: the unique index makes this a single atomic upsert. */
  async set(key: string, value: string): Promise<void> {
    requireKey(key);
    await this.prisma.appState.upsert({
      where: { key },
      create: { key, value },
      update: { value },
    });
  }
}

// The database rejects an empty key as well; failing here names the mistake
// instead of surfacing a constraint violation.
function requireKey(key: string): void {
  if (key === '') throw new RangeError('AppState key must not be empty');
}

@Module({
  providers: [AppStateService],
  exports: [AppStateService],
})
export class AppStateModule {}
