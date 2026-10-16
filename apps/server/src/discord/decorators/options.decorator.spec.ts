import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ROUTE_ARGS_METADATA } from '@nestjs/common/constants.js';
import { StringOption } from 'necord';
import { describe, expect, it } from 'vitest';
import { OmitEmptyOptionsPipe, Options } from './options.decorator.js';

describe('OmitEmptyOptionsPipe', () => {
  const pipe = new OmitEmptyOptionsPipe();

  it('drops the options the person left empty and keeps every given value', () => {
    expect(pipe.transform({ content: 'hi', replyMessage: null, count: 0, flag: false })).toEqual({
      content: 'hi',
      count: 0,
      flag: false,
    });
    expect(pipe.transform({ replyMessage: null })).not.toHaveProperty('replyMessage');
  });

  it('passes a non-object through unchanged', () => {
    expect(pipe.transform(null)).toBeNull();
    expect(pipe.transform('x')).toBe('x');
  });
});

describe('Options', () => {
  it('runs the empty-option pipe before the pipes a handler adds', () => {
    class Extra {
      transform(value: unknown) {
        return value;
      }
    }
    const extra = new Extra();
    class Handler {
      run(@Options(extra) _options: unknown) {}
    }
    const args = Reflect.getMetadata(ROUTE_ARGS_METADATA, Handler, 'run') as Record<
      string,
      { pipes: unknown[] }
    >;
    const [{ pipes }] = Object.values(args) as [{ pipes: unknown[] }];
    expect(pipes[0]).toBeInstanceOf(OmitEmptyOptionsPipe);
    expect(pipes[1]).toBe(extra);
  });

  it("keeps Necord's option metadata, which slash command registration reads", () => {
    class TopicOptions {
      @StringOption({ name: 'topic', description: 'Topic', required: false })
      readonly topic?: string;
    }
    class Handler {
      run(@Options() _options: TopicOptions) {}
    }
    const run: unknown = Object.getOwnPropertyDescriptor(Handler.prototype, 'run')?.value;
    expect(Reflect.getMetadata('necord:options_meta', run as object)).toMatchObject({
      topic: { name: 'topic', required: false },
    });
  });

  it('is the only way command code reads options', () => {
    const root = join(__dirname, '..', '..');
    const offenders = readdirSync(root, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .filter((file) => {
        const source = readFileSync(join(root, file), 'utf8');
        return /import\s*\{[^}]*\b(Options|Opts)\b[^}]*\}\s*from\s*'necord'/.test(source);
      })
      .filter((file) => !file.endsWith(join('decorators', 'options.decorator.ts')));
    expect(offenders).toEqual([]);
  });
});
