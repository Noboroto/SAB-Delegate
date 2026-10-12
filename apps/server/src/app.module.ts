import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { loadEnv } from './config/env.js';
import { HealthModule } from './health/health.module.js';
import { buildPinoParams } from './logger/pino.config.js';

@Module({
  imports: [
    LoggerModule.forRootAsync({
      // Validated here as well as in main.ts: the module must not boot on an
      // environment the entry point never looked at.
      useFactory: () => buildPinoParams(loadEnv().LOG_LEVEL),
    }),
    HealthModule,
  ],
})
export class AppModule {}
