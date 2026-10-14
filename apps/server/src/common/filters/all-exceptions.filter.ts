import {
  Catch,
  HttpException,
  Logger,
  type ArgumentsHost,
  type ExceptionFilter,
} from '@nestjs/common';
import { ErrorCode, type ApiErrorBody } from '@sab/shared';
import { DiscordAPIError, HTTPError, RateLimitError } from 'discord.js';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { errorLabel } from '../../prisma/pool-factory.js';
import { isInfrastructureError } from '../guild-access/guild-access.service.js';
import { ApiError, errorBody, statusOf } from '../errors/http-error.js';
import { ServiceError } from '../errors/service-error.js';

const HEALTH_PATH = /^\/health(\/|$)/;

type Rendered = { status: number; body: ApiErrorBody; unexpected?: true };

function codeForStatus(status: number): ErrorCode {
  if (status === 401) return ErrorCode.AUTH_UNAUTHENTICATED;
  if (status === 403) return ErrorCode.AUTH_FORBIDDEN;
  // Every 404 the API can give is "not found for you"; routes and servers alike.
  if (status === 404) return ErrorCode.GUILD_NOT_FOUND;
  if (status === 429) return ErrorCode.RATE_LIMITED;
  return status >= 400 && status < 500 ? ErrorCode.VALIDATION_FAILED : ErrorCode.INTERNAL;
}

/** Discord rate limiting or an outage reaching us as a raw library error, not as a `ServiceError`. */
function discordFailure(exception: unknown): ErrorCode | undefined {
  if (exception instanceof RateLimitError) return ErrorCode.RATE_LIMITED;
  if (exception instanceof DiscordAPIError && exception.status === 429) {
    return ErrorCode.RATE_LIMITED;
  }
  if (
    exception instanceof DiscordAPIError ||
    exception instanceof HTTPError ||
    isInfrastructureError(exception)
  ) {
    return ErrorCode.DISCORD_API_ERROR;
  }
  return undefined;
}

/** Fastify's own failures (invalid JSON, body too large) carry a numeric 4xx `statusCode`. */
function clientStatusOf(exception: unknown): number | undefined {
  const status = (exception as { statusCode?: unknown } | null)?.statusCode;
  return typeof status === 'number' && status >= 400 && status < 500 ? status : undefined;
}

/**
 * The one place a thrown error becomes an HTTP answer: `{ code, message,
 * details? }`, built from the catalog. The thrown error's own message is never
 * read, so a Prisma error cannot leak a table or column, nor an upstream error
 * its URL. Unexpected failures are logged by class and code only.
 *
 * Discord interactions and events (`necord` context) have their own filter and
 * reply channel: anything reaching here from there is logged and re-thrown, the
 * same as Nest's default for a context without an HTTP response.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    if (host.getType() !== 'http') {
      this.logger.error(`Unhandled exception outside HTTP (${errorLabel(exception)})`);
      throw exception;
    }
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const route = request.routeOptions.url ?? 'unmatched';

    // The probes' bodies say which dependency is down and hold nothing private.
    if (exception instanceof HttpException && HEALTH_PATH.test(route)) {
      void reply.status(exception.getStatus()).send(exception.getResponse());
      return;
    }

    const { status, body, unexpected } = this.render(exception);
    if (unexpected) {
      this.logger.error(
        `Unhandled exception (${errorLabel(exception)}) on ${request.method} ${route}`,
      );
    }
    void reply.status(status).send(body);
  }

  private render(exception: unknown): Rendered {
    if (exception instanceof ApiError) {
      return { status: exception.getStatus(), body: exception.getResponse() as ApiErrorBody };
    }
    if (exception instanceof ServiceError) {
      return {
        status: statusOf(exception.code),
        body: errorBody(exception.code, exception.params),
      };
    }
    const discord = discordFailure(exception);
    if (discord !== undefined) return { status: statusOf(discord), body: errorBody(discord) };

    const status =
      exception instanceof HttpException ? exception.getStatus() : clientStatusOf(exception);
    if (status !== undefined && status >= 400 && status < 500) {
      return { status, body: errorBody(codeForStatus(status)) };
    }
    return { status: 500, body: errorBody(ErrorCode.INTERNAL), unexpected: true };
  }
}
