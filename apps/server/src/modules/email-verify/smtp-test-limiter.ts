import { Injectable } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { ServiceError } from '../../common/errors/service-error.js';
import { WindowCounter } from './window-counter.js';

export const SMTP_TEST_MAX = 5;
export const SMTP_TEST_WINDOW_MS = 10 * 60_000;

/**
 * Connection tests of the SMTP account per person, in memory: a test opens a
 * connection to a host an admin typed, so it is not free to repeat.
 */
@Injectable()
export class SmtpTestLimiter {
  private readonly counter = new WindowCounter(SMTP_TEST_MAX, SMTP_TEST_WINDOW_MS);

  /** Counts one test; throws `RATE_LIMITED` once the person used up the window. */
  consume(userId: string): void {
    if (!this.counter.tryConsume(userId)) throw new ServiceError(ErrorCode.RATE_LIMITED);
  }
}
