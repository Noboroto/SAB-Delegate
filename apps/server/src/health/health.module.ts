import { Module } from '@nestjs/common';
import { DiscordReadyModule } from '../discord/discord-ready.service.js';
import { HealthController, LivenessController } from './health.controller.js';

@Module({ imports: [DiscordReadyModule], controllers: [LivenessController, HealthController] })
export class HealthModule {}
