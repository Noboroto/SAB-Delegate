import { describe, expect, it } from 'vitest';

// Loaded through a variable specifier so tsc/eslint's project service never
// pulls the .mjs into the TS program (it is linted by the .mjs config block).
type Run = (deps: {
  argv: string[];
  env: Record<string, string | undefined>;
  createRest: (token: string) => unknown;
  routes: unknown;
  log: (line: string) => void;
  logError: (line: string) => void;
}) => Promise<number>;
const scriptPath = './clear-legacy-commands.mjs';
const { run } = (await import(scriptPath)) as { run: Run };

const CLIENT_ID = '123456789012345678';
// Built at runtime so no token-shaped literal lives in the repo. The first
// segment is the base64url of the application id, as in a real token.
const tokenFor = (applicationId: string) =>
  [Buffer.from(applicationId).toString('base64url'), 'legacy', String(Date.now())].join('.');
const TOKEN = tokenFor(CLIENT_ID);
// Built at runtime: a literal id next to `DISCORD_CLIENT_ID` trips the secret scanner.
const OTHER_APP_ID = '3'.repeat(18);
const GUILD_ID = '987654321098765432';

const routes = {
  applicationCommands: (id: string) => `global:${id}`,
  applicationGuildCommands: (id: string, guildId: string) => `guild:${id}:${guildId}`,
};

interface Call {
  method: 'get' | 'put';
  route: string;
  body?: unknown;
}

function harness(options: { initial?: string[]; afterPut?: string[]; failWith?: string } = {}) {
  const calls: Call[] = [];
  let registered = (options.initial ?? ['ping', 'poll']).map((name) => ({ name }));
  const rest = {
    get: (route: string) => {
      calls.push({ method: 'get', route });
      if (options.failWith) return Promise.reject(new Error(options.failWith));
      return Promise.resolve(registered);
    },
    put: (route: string, { body }: { body: unknown[] }) => {
      calls.push({ method: 'put', route, body });
      registered = (options.afterPut ?? []).map((name) => ({ name }));
      return Promise.resolve([]);
    },
  };
  const out: string[] = [];
  const err: string[] = [];
  const exec = (argv: string[], env: Record<string, string | undefined> = {}) =>
    run({
      argv,
      env: { LEGACY_BOT_TOKEN: TOKEN, LEGACY_CLIENT_ID: CLIENT_ID, ...env },
      createRest: () => rest,
      routes,
      log: (line) => out.push(line),
      logError: (line) => err.push(line),
    });
  return { calls, out, err, exec };
}

describe('clear-legacy-commands', () => {
  it('dry-run is the default, lists count and names and never PUTs', async () => {
    const h = harness();
    expect(await h.exec([])).toBe(0);
    expect(h.calls.map((c) => c.method)).toEqual(['get']);
    expect(h.out.join('\n')).toContain('2 registered');
    expect(h.out.join('\n')).toContain('ping, poll');
  });

  it('apply PUTs an empty list then verifies zero remain', async () => {
    const h = harness();
    expect(await h.exec(['--apply'])).toBe(0);
    expect(h.calls.map((c) => c.method)).toEqual(['get', 'put', 'get']);
    expect(h.calls[1]).toMatchObject({ route: `global:${CLIENT_ID}`, body: [] });
    expect(h.out.join('\n')).toContain('0 command(s) remaining');
  });

  it('apply fails when commands survive the PUT', async () => {
    const h = harness({ afterPut: ['ping'] });
    expect(await h.exec(['--apply'])).toBe(1);
    expect(h.err.join('\n')).toContain('Verification failed');
  });

  it('guild mode uses the guild route', async () => {
    const h = harness();
    expect(await h.exec(['--apply', '--guild', GUILD_ID])).toBe(0);
    expect(new Set(h.calls.map((c) => c.route))).toEqual(
      new Set([`guild:${CLIENT_ID}:${GUILD_ID}`]),
    );
  });

  it('missing env exits non-zero naming only the variables', async () => {
    const h = harness();
    expect(await h.exec([], { LEGACY_BOT_TOKEN: '', LEGACY_CLIENT_ID: undefined })).toBe(2);
    const text = h.err.join('\n');
    expect(text).toContain('LEGACY_BOT_TOKEN');
    expect(text).toContain('LEGACY_CLIENT_ID');
    expect(h.calls).toHaveLength(0);
  });

  it.each([
    [['--apply', '--dry-run']],
    [['--guild', 'not-a-snowflake']],
    [['--guild']],
    [['--nope']],
  ])('rejects bad arguments %j before any request', async (argv) => {
    const h = harness();
    expect(await h.exec(argv)).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('rejects a client id that is not a snowflake', async () => {
    const h = harness();
    expect(await h.exec([], { LEGACY_CLIENT_ID: 'abc' })).toBe(2);
    expect(h.calls).toHaveLength(0);
  });

  it('refuses a client id that differs from the one encoded in the token', async () => {
    const h = harness();
    const other = '223456789012345678';
    expect(await h.exec([], { LEGACY_CLIENT_ID: other })).toBe(2);
    expect(h.calls).toHaveLength(0);
    const text = h.err.join('\n');
    expect(text).toContain('does not match');
    expect(text).not.toContain(other);
    expect(text).not.toContain(TOKEN);
  });

  it.each(['not-base64.!!.x', 'bm90LWEtc25vd2ZsYWtl.x.y'])(
    'refuses a token whose first segment is not an application id (%s)',
    async (token) => {
      const h = harness();
      expect(await h.exec([], { LEGACY_BOT_TOKEN: token })).toBe(2);
      expect(h.calls).toHaveLength(0);
      expect(h.err.join('\n')).not.toContain(token);
    },
  );

  it('refuses to run against the new bot application', async () => {
    const h = harness();
    expect(await h.exec(['--apply'], { DISCORD_CLIENT_ID: CLIENT_ID })).toBe(2);
    expect(h.calls).toHaveLength(0);
    expect(h.err.join('\n')).toContain('new bot');
  });

  it('proceeds when DISCORD_CLIENT_ID is another application', async () => {
    const h = harness();
    expect(await h.exec([], { DISCORD_CLIENT_ID: OTHER_APP_ID })).toBe(0);
  });

  it('never prints the token, even when the REST error contains it', async () => {
    const h = harness({ failWith: `401 for Authorization: Bot ${TOKEN}` });
    expect(await h.exec(['--apply'])).toBe(1);
    const everything = [...h.out, ...h.err].join('\n');
    expect(everything).not.toContain(TOKEN);
    expect(everything).toContain('[redacted]');
  });
});
