import 'reflect-metadata';
import helmet from '@fastify/helmet';
import { StandardSchemaValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { FASTIFY_OPTIONS, HELMET_OPTIONS } from './bootstrap/security-config.js';
import { InvalidEnvError, loadEnv } from './config/env.js';

// Fixed by the image, not configurable: compose and the reverse proxy point at
// it. Not 5000 or 7000, which AirPlay holds on macOS dev machines.
const PORT = 3100;
const HOST = '0.0.0.0';

async function bootstrap(): Promise<void> {
  // Fail before opening any socket or loading the Discord client.
  loadEnv();

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(FASTIFY_OPTIONS),
    // Hold Nest's own boot logs until pino is installed, so they are structured
    // and redacted like every other line.
    { bufferLogs: true },
  );
  app.useLogger(app.get(Logger));

  await app.register(helmet, HELMET_OPTIONS);

  // Nest 12's native Standard Schema pipe: `@Body({ schema })` takes a schema
  // from '@sab/shared' directly. Fields the schema does not declare are
  // stripped, an invalid body is a 400.
  app.useGlobalPipes(new StandardSchemaValidationPipe());

  // Nest listens for SIGTERM/SIGINT, runs the module destroy hooks, closes the
  // HTTP server and re-raises the signal, so the process exits cleanly.
  app.enableShutdownHooks();

  await app.listen(PORT, HOST);
}

bootstrap().catch((error: unknown) => {
  // Only variable names: an environment error must never echo a value.
  if (error instanceof InvalidEnvError) {
    console.error(error.message);
  } else {
    console.error(error);
  }
  process.exit(1);
});
