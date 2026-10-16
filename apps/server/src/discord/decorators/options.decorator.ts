import type { PipeTransform } from '@nestjs/common';
import { Options as NecordOptions } from 'necord';

/**
 * discord.js answers an optional option the person left empty with `null`
 * (`getString(name, false)`), while every handler and service treats "not
 * given" as `undefined`. Measured in production: `/bot-message send` without
 * `reply-message` passed `null` on as a link and crashed. Dropping the empty
 * options here keeps the `?: T` option types true for every command.
 */
export class OmitEmptyOptionsPipe implements PipeTransform {
  transform(value: unknown): unknown {
    if (typeof value !== 'object' || value === null) return value;
    return Object.fromEntries(Object.entries(value).filter(([, option]) => option !== null));
  }
}

const OMIT_EMPTY = new OmitEmptyOptionsPipe();

/** Necord's `@Options()`, with the options the person left empty absent instead of `null`. */
export const Options = (...pipes: PipeTransform[]): ParameterDecorator =>
  NecordOptions(OMIT_EMPTY, ...pipes);
