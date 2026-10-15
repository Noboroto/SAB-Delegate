import 'reflect-metadata';
import cookie from '@fastify/cookie';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { mountAuth } from './auth/auth.handler.js';
import { AUTH, type Auth } from './auth/better-auth.js';
import { SessionService } from './auth/session.service.js';
import { fastifyOptions, HELMET_OPTIONS } from './bootstrap/security-config.js';
import { validationFailed } from './common/errors/http-error.js';
import { rateLimitOptions } from './common/rate-limit/rate-limit.util.js';
import { InvalidEnvError, loadEnv, restSettingsOf } from './config/env.js';
import { BootGuardError } from './discord/boot-guard.js';

// Fixed by the image, not configurable: compose and the reverse proxy point at
// it. Not 5000 or 7000, which AirPlay holds on macOS dev machines.
const PORT = 3100;
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  // Fail before opening any socket or loading the Discord client.
  const rest = restSettingsOf(loadEnv());

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(fastifyOptions(rest?.trustedProxies)),
    // Hold Nest's own boot logs until pino is installed, so they are structured
    // and redacted like every other line. A failure while building the modules
    // (an unverifiable bot token, an unreachable database) rejects here and is
    // reported and exited below, instead of Nest calling process.abort().
    { bufferLogs: true, abortOnError: false },
  );
  app.useLogger(app.get(Logger));

  await app.register(helmet, HELMET_OPTIONS);

  if (rest !== undefined) {
    // Parses the Cookie header for `OriginGuard`; Better Auth reads the raw
    // header itself and sets its own cookies.
    await app.register(cookie);
    // Before the auth route is added, so sign-in attempts are counted too.
    const logger = app.get(Logger);
    await app.register(
      rateLimit,
      rateLimitOptions(app.get(SessionService), (event) => {
        logger.log({ ...event, msg: 'request rate limited' });
      }),
    );
    mountAuth(app.getHttpAdapter().getInstance(), app.get<Auth>(AUTH));
  }

  // Nest 12's native Standard Schema pipe: `@Body({ schema })` takes a schema
  // from '@sab/shared' directly. Fields the schema does not declare are
  // stripped, an invalid body is a 400.
  app.useGlobalPipes(new StandardSchemaValidationPipe({ exceptionFactory: validationFailed }));

  // Nest listens for SIGTERM/SIGINT, runs the module destroy hooks, closes the
  // HTTP server and re-raises the signal, so the process exits cleanly.
  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
}

bootstrap().catch((error: unknown) => {
  // Only variable names and public application ids: neither error echoes a value.
  if (error instanceof InvalidEnvError || error instanceof BootGuardError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
