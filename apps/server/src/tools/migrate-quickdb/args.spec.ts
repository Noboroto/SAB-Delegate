import { describe, expect, it } from 'vitest';
import { ArgsError, parseArgs } from './args.js';

describe('parseArgs', () => {
  it('defaults to a dry run of the migrate command', () => {
    expect(parseArgs(['--source', '/data'])).toEqual({
      command: 'migrate',
      sourceDir: '/data',
      apply: false,
      allowNonEmpty: false,
      dictAsset: null,
    });
  });

  it('writes only with --apply and records --allow-non-empty', () => {
    expect(parseArgs(['migrate', '--source=/data', '--apply', '--allow-non-empty'])).toMatchObject({
      apply: true,
      allowNonEmpty: true,
    });
  });

  it('rejects --allow-non-empty without --apply', () => {
    expect(() => parseArgs(['--source', '/data', '--allow-non-empty'])).toThrow(ArgsError);
  });

  it('requires a source and rejects unknown or misplaced flags without echoing their value', () => {
    expect(() => parseArgs([])).toThrow('--source is required');
    expect(() => parseArgs(['--source', '/data', '--note-guild-map', 'x'])).toThrow(
      'Unknown argument --note-guild-map',
    );
    expect(() => parseArgs(['--source', '/data', '--bogus=hunter2'])).toThrow(/--bogus$/);
    expect(() => parseArgs(['--source'])).toThrow('--source needs a value');
    expect(() => parseArgs(['--source', '/data', '--target', '/x'])).toThrow(
      '--target does not apply',
    );
  });

  it('parses export-claims with a bounded day count', () => {
    expect(parseArgs(['export-claims', '--target', '/old'])).toEqual({
      command: 'export-claims',
      targetDir: '/old',
      days: 2,
    });
    expect(parseArgs(['export-claims', '--target', '/old', '--days', '3'])).toMatchObject({
      days: 3,
    });
    for (const days of ['0', '8', 'x', '1.5']) {
      expect(() => parseArgs(['export-claims', '--target', '/old', '--days', days])).toThrow(
        ArgsError,
      );
    }
    expect(() => parseArgs(['export-claims', '--apply'])).toThrow('--apply does not apply');
  });
});
