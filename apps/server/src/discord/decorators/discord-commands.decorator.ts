import { Injectable, UseFilters, applyDecorators } from '@nestjs/common';
import { DiscordExceptionFilter } from '../filters/discord-exception.filter.js';

/**
 * Put this on every class that holds Necord handlers (commands, listeners,
 * modals, components). It makes the class a provider and routes whatever its
 * handlers throw to `DiscordExceptionFilter`; without it an error in a handler
 * reaches nobody and the user's interaction times out.
 */
export function DiscordCommands(): ClassDecorator {
  return applyDecorators(Injectable(), UseFilters(DiscordExceptionFilter));
}
