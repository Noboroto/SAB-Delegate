import { randomBytes } from 'node:crypto';
import { Injectable } from '@nestjs/common';
import { argsFingerprint } from './write-guard.js';

export const CONFIRM_TOKEN_TTL_MS = 5 * 60_000;
/** Outstanding tokens per key; the oldest is dropped, and its holder only has to run `dryRun` again. */
export const CONFIRM_TOKENS_PER_KEY = 20;
const TOKEN_PREFIX = 'ct_';

type Entry = { apiKeyId: string; tool: string; fingerprint: string; expiresAt: number };

/**
 * Tokens that turn a preview into permission to act. A model fills in any
 * boolean it is shown, so a `confirm: true` would not be a gate; a token the
 * server issued for exactly this key, tool and arguments, usable once, is.
 * In memory: a restart only means asking for the preview again.
 */
@Injectable()
export class ConfirmTokenService {
  private readonly entries = new Map<string, Entry>();
  /** Tokens per key in issue order, for the per-key cap. */
  private readonly byKey = new Map<string, string[]>();

  issue(
    apiKeyId: string,
    tool: string,
    args: Record<string, unknown>,
  ): { token: string; expiresInSeconds: number } {
    const now = Date.now();
    this.sweep(now);
    const token = `${TOKEN_PREFIX}${randomBytes(24).toString('base64url')}`;
    this.entries.set(token, {
      apiKeyId,
      tool,
      fingerprint: argsFingerprint(args),
      expiresAt: now + CONFIRM_TOKEN_TTL_MS,
    });
    const tokens = this.byKey.get(apiKeyId) ?? [];
    tokens.push(token);
    while (tokens.length > CONFIRM_TOKENS_PER_KEY) {
      const dropped = tokens.shift();
      if (dropped !== undefined) this.entries.delete(dropped);
    }
    this.byKey.set(apiKeyId, tokens);
    return { token, expiresInSeconds: CONFIRM_TOKEN_TTL_MS / 1000 };
  }

  /**
   * Consumes the token whatever the outcome: a token shown with other
   * arguments, tool or key is spent, so guessing which one a stolen token fits
   * costs the thief the token.
   */
  verify(token: string, apiKeyId: string, tool: string, args: Record<string, unknown>): boolean {
    const entry = this.entries.get(token);
    if (entry === undefined) return false;
    this.remove(token, entry);
    return (
      entry.expiresAt > Date.now() &&
      entry.apiKeyId === apiKeyId &&
      entry.tool === tool &&
      entry.fingerprint === argsFingerprint(args)
    );
  }

  /**
   * Gives back a token `verify` just spent because the call was refused before
   * it did anything (the server's action budget was full), so the holder can
   * retry without another preview. The window starts again.
   */
  reinstate(token: string, apiKeyId: string, tool: string, args: Record<string, unknown>): void {
    if (this.entries.has(token)) return;
    this.entries.set(token, {
      apiKeyId,
      tool,
      fingerprint: argsFingerprint(args),
      expiresAt: Date.now() + CONFIRM_TOKEN_TTL_MS,
    });
    const tokens = this.byKey.get(apiKeyId) ?? [];
    tokens.push(token);
    while (tokens.length > CONFIRM_TOKENS_PER_KEY) {
      const dropped = tokens.shift();
      if (dropped !== undefined) this.entries.delete(dropped);
    }
    this.byKey.set(apiKeyId, tokens);
  }

  /** Outstanding tokens, for tests and for the cap. */
  get size(): number {
    return this.entries.size;
  }

  private remove(token: string, entry: Entry): void {
    this.entries.delete(token);
    const tokens = this.byKey.get(entry.apiKeyId);
    if (tokens === undefined) return;
    const rest = tokens.filter((candidate) => candidate !== token);
    if (rest.length === 0) this.byKey.delete(entry.apiKeyId);
    else this.byKey.set(entry.apiKeyId, rest);
  }

  private sweep(now: number): void {
    for (const [token, entry] of this.entries) {
      if (entry.expiresAt <= now) this.remove(token, entry);
    }
  }
}
