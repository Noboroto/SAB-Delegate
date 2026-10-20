import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { WindowCounter } from './window-counter.js';

export const ADDRESS_CHECK_MAX = 10;
export const TEST_MAIL_MAX = 5;
const EMAIL_ACTION_WINDOW_MS = 10 * 60_000;

/**
 * In-memory limits on what a person can ask of the verification flow beyond
 * the mail limits stored in the database.
 *
 * - Address checks: every address a member submits is answered with whether
 *   the server's rules accept it (distinct errors, which managers want), so
 *   unlimited tries would let anyone map the allowlist. Ten a window is plenty
 *   for typos.
 * - Test mails: a manager can mail any address, so each person gets a few.
 *
 * Both throw `RATE_LIMITED`.
 */
@Injectable()
export class EmailActionLimiter {
  private readonly addressChecks = new WindowCounter(ADDRESS_CHECK_MAX, EMAIL_ACTION_WINDOW_MS);
  private readonly testMails = new WindowCounter(TEST_MAIL_MAX, EMAIL_ACTION_WINDOW_MS);

  /** Counts one address a member submitted in a server. */
  consumeAddressCheck(guildId: string, userId: string): void {
    if (!this.addressChecks.tryConsume(`${guildId}:${userId}`)) {
      throw new ServiceError(ErrorCode.RATE_LIMITED);
    }
  }

  /** Counts one test mail asked for by `actorKey` (a Discord id, or the kind of caller without one). */
  consumeTestMail(actorKey: string): void {
    if (!this.testMails.tryConsume(actorKey)) throw new ServiceError(ErrorCode.RATE_LIMITED);
  }
}
