// Structural rules for the deploy compose files. Coolify rewrites or rejects
// several compose features, and a mistake here fails a production deploy
// without touching a test elsewhere, so the rules are pinned as a spec.
//
// The files are parsed with a small reader for the block style they are written
// in (maps, lists, flow lists, block scalars). Anything outside that subset
// throws, so a new construct cannot slip past the checks unread.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const REPO_ROOT = join(import.meta.dirname, '..');

type Node = string | Node[] | { [key: string]: Node };
type Mapping = { [key: string]: Node };

interface Line {
  indent: number;
  text: string;
}

function stripComment(text: string): string {
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === quote) quote = null;
    } else if (c === "'" || c === '"') {
      quote = c;
    } else if (c === '#' && (i === 0 || text[i - 1] === ' ')) {
      return text.slice(0, i);
    }
  }
  return text;
}

function unquote(raw: string): string {
  const value = raw.trim();
  if (value.length >= 2 && (value[0] === "'" || value[0] === '"') && value.endsWith(value[0])) {
    return value.slice(1, -1);
  }
  return value;
}

function splitFlow(inner: string): string[] {
  const items: string[] = [];
  let quote: string | null = null;
  let current = '';
  for (const c of inner) {
    if (quote) {
      if (c === quote) quote = null;
      current += c;
    } else if (c === "'" || c === '"') {
      quote = c;
      current += c;
    } else if (c === ',') {
      items.push(current);
      current = '';
    } else {
      current += c;
    }
  }
  if (current.trim() !== '') items.push(current);
  return items.map(unquote);
}

function scalar(raw: string): Node {
  const value = raw.trim();
  if (value === '{}') return {};
  if (value.startsWith('[') && value.endsWith(']')) return splitFlow(value.slice(1, -1));
  if (value.startsWith('{') || value.startsWith('[')) {
    throw new Error(`unsupported flow value: ${value}`);
  }
  return unquote(value);
}

/** Reads the lines, folding each block scalar (`|`, `>`) into one text line. */
function tokenize(text: string): Line[] {
  const raw = text.split('\n');
  const lines: Line[] = [];
  for (let i = 0; i < raw.length; i++) {
    const source = raw[i]!;
    const stripped = stripComment(source).trimEnd();
    if (stripped.trim() === '') continue;
    const indent = stripped.length - stripped.trimStart().length;
    const content = stripped.trimStart();
    if (content.endsWith(': |') || content === '- |') {
      const body: string[] = [];
      while (i + 1 < raw.length) {
        const next = raw[i + 1]!;
        const nextIndent = next.length - next.trimStart().length;
        if (next.trim() !== '' && nextIndent <= indent) break;
        body.push(next.trim());
        i++;
      }
      const head = content.slice(0, content.length - 1).trimEnd();
      lines.push({ indent, text: `${head} ${JSON.stringify(body.join('\n'))}` });
      continue;
    }
    lines.push({ indent, text: content });
  }
  return lines;
}

function parseYaml(text: string): Mapping {
  const lines = tokenize(text);
  let pos = 0;

  const value = (rest: string): Node => {
    const t = rest.trim();
    if (t.startsWith('"') && t.endsWith('"') && t.includes('\\n')) {
      return JSON.parse(t) as string;
    }
    return scalar(t);
  };

  const parseBlock = (indent: number): Node => {
    const first = lines[pos]!;
    return first.text.startsWith('- ') || first.text === '-' ? parseList(indent) : parseMap(indent);
  };

  const parseList = (indent: number): Node[] => {
    const list: Node[] = [];
    while (
      pos < lines.length &&
      lines[pos]!.indent === indent &&
      lines[pos]!.text.startsWith('-')
    ) {
      const item = lines[pos]!.text.slice(1).trim();
      if (/^[A-Za-z_][\w.-]*:(\s|$)/.test(item)) {
        throw new Error(`unsupported list item (map in list): ${item}`);
      }
      list.push(value(item));
      pos++;
    }
    return list;
  };

  const parseMap = (indent: number): Mapping => {
    const map: Mapping = {};
    while (pos < lines.length && lines[pos]!.indent === indent) {
      const line = lines[pos]!;
      const match = /^("[^"]*"|'[^']*'|[^:\s][^:]*?):(?:\s+(.*))?$/.exec(line.text);
      if (!match) throw new Error(`cannot read line: ${line.text}`);
      const key = unquote(match[1]!);
      const rest = match[2];
      pos++;
      if (rest !== undefined && rest !== '') {
        map[key] = value(rest);
        continue;
      }
      const next = lines[pos];
      const nested =
        next !== undefined &&
        (next.indent > indent || (next.indent === indent && next.text.startsWith('- ')));
      map[key] = nested ? parseBlock(next.indent) : '';
    }
    return map;
  };

  const root = parseMap(lines[0]?.indent ?? 0);
  if (pos !== lines.length) throw new Error(`unparsed content near: ${lines[pos]!.text}`);
  return root;
}

/** Comments may name a forbidden construct to explain why it is absent. */
function withoutComments(text: string): string {
  return text.split('\n').map(stripComment).join('\n');
}

function read(file: string): { text: string; doc: Mapping } {
  const text = readFileSync(join(REPO_ROOT, file), 'utf8');
  return { text, doc: parseYaml(text) };
}

function asMap(node: Node | undefined, what: string): Mapping {
  if (node === undefined || typeof node === 'string' || Array.isArray(node)) {
    throw new Error(`${what} must be a mapping`);
  }
  return node;
}

function servicesOf(doc: Mapping): [string, Mapping][] {
  return Object.entries(asMap(doc['services'], 'services')).map(([name, body]) => [
    name,
    asMap(body, `service ${name}`),
  ]);
}

function stringOf(node: Node | undefined, what: string): string {
  if (typeof node !== 'string') throw new Error(`${what} must be a string`);
  return node;
}

function networkNames(service: Mapping): string[] {
  const networks = service['networks'];
  if (Array.isArray(networks)) return networks.map(String);
  if (networks && typeof networks === 'object') return Object.keys(networks);
  return [];
}

function envKeys(service: Mapping): string[] | undefined {
  const env = service['environment'];
  if (Array.isArray(env))
    return env.map((entry) => stringOf(entry, 'environment entry').split('=')[0]!);
  if (env && typeof env === 'object') return Object.keys(env);
  return undefined;
}

const PROD_FILES = ['coolify.compose.yml', 'deploy/postgres.compose.yml'] as const;
const ALL_FILES = [
  'coolify.compose.yml',
  'compose.yml',
  'deploy/postgres.compose.yml',
  'deploy/local-smoke.compose.yml',
] as const;
const RELEASE_JOB_SERVICES = ['sab-release', 'sab-server', 'sab-backup'];
const DIGEST = /@sha256:[0-9a-f]{64}$/;

describe('every compose file', () => {
  it.each(ALL_FILES)('%s has no ${VAR:?} requirement', (file) => {
    expect(withoutComments(read(file).text)).not.toMatch(/\$\{[A-Za-z_][A-Za-z0-9_]*:?\?/);
  });

  it.each(ALL_FILES)('%s has no list-form depends_on and no restart: always', (file) => {
    for (const [name, service] of servicesOf(read(file).doc)) {
      expect(Array.isArray(service['depends_on']), `${file} ${name} depends_on`).toBe(false);
      expect(service['restart'], `${file} ${name} restart`).not.toBe('always');
    }
  });

  it.each(ALL_FILES)('%s pins every registry image by digest', (file) => {
    for (const [name, service] of servicesOf(read(file).doc)) {
      const image = service['image'];
      if (typeof image === 'string') expect(image, `${file} ${name}`).toMatch(DIGEST);
    }
  });

  it.each(ALL_FILES)('%s uses the Debian Postgres 18.6 image', (file) => {
    const images = servicesOf(read(file).doc).flatMap(([, s]) =>
      typeof s['image'] === 'string' ? [s['image']] : [],
    );
    for (const image of images) {
      expect(image).toMatch(/^postgres:18\.6@/);
    }
  });
});

describe('production compose files', () => {
  it.each(PROD_FILES)('%s forbids ports, container_name, service cpus, env_file', (file) => {
    for (const [name, service] of servicesOf(read(file).doc)) {
      expect(service['ports'], `${file} ${name} ports`).toBeUndefined();
      expect(service['container_name'], `${file} ${name} container_name`).toBeUndefined();
      expect(service['cpus'], `${file} ${name} cpus`).toBeUndefined();
      expect(service['env_file'], `${file} ${name} env_file`).toBeUndefined();
    }
  });

  it.each(PROD_FILES)('%s has no named volumes, only /srv/appdata directories', (file) => {
    const { doc } = read(file);
    expect(doc['volumes'], `${file} top-level volumes`).toBeUndefined();
    for (const [name, service] of servicesOf(doc)) {
      const volumes = service['volumes'];
      if (volumes === undefined) continue;
      expect(Array.isArray(volumes), `${file} ${name} volumes`).toBe(true);
      for (const entry of volumes as string[]) {
        const source = entry.split(':')[0]!;
        expect(source, `${file} ${name} ${entry}`).toMatch(/^\/srv\/appdata\/sab-delegate\//);
        // A single file keeps its old inode after a git pull.
        expect(source.split('/').pop()!, `${file} ${name} ${entry}`).not.toMatch(/\.[A-Za-z0-9]+$/);
      }
    }
  });

  it.each(PROD_FILES)('%s declares sab-db as an external network', (file) => {
    const networks = asMap(read(file).doc['networks'], 'networks');
    expect(asMap(networks['sab-db'], 'sab-db')['external']).toBe('true');
  });

  it('postgres resource keeps UTC, the alias, the PG18 data path and a healthcheck', () => {
    const { doc } = read('deploy/postgres.compose.yml');
    const postgres = asMap(asMap(doc['services'], 'services')['sab-postgres'], 'sab-postgres');
    expect(postgres['command']).toEqual(
      expect.arrayContaining(['timezone=UTC', 'log_timezone=UTC']),
    );
    const sabDb = asMap(asMap(postgres['networks'], 'networks')['sab-db'], 'sab-db');
    expect(sabDb['aliases']).toEqual(['sab-postgres']);
    expect(postgres['volumes']).toEqual([
      '/srv/appdata/sab-delegate/postgres:/var/lib/postgresql:rw',
    ]);
    expect(postgres['healthcheck']).toBeDefined();
  });
});

describe('coolify.compose.yml', () => {
  const { text, doc } = read('coolify.compose.yml');
  const services = Object.fromEntries(servicesOf(doc));

  it('has exactly the release, server and backup services', () => {
    expect(Object.keys(services).sort()).toEqual([...RELEASE_JOB_SERVICES].sort());
  });

  it('puts only those three services on sab-db', () => {
    const onDb = Object.entries(services)
      .filter(([, service]) => networkNames(service).includes('sab-db'))
      .map(([name]) => name);
    expect(onDb.sort()).toEqual([...RELEASE_JOB_SERVICES].sort());
  });

  it('keeps the backup job off every network but sab-db', () => {
    expect(networkNames(services['sab-backup']!)).toEqual(['sab-db']);
  });

  it('lists environment variables explicitly for every service', () => {
    for (const [name, service] of Object.entries(services)) {
      const keys = envKeys(service);
      expect(keys, `${name} environment`).toBeDefined();
      expect(keys!.length, `${name} environment`).toBeGreaterThan(0);
    }
  });

  it('never hands the legacy TOKENS or LEGACY_* variables to a service', () => {
    for (const [name, service] of Object.entries(services)) {
      for (const key of envKeys(service) ?? []) {
        expect(key, `${name} ${key}`).not.toBe('TOKENS');
        expect(key, `${name} ${key}`).not.toMatch(/^LEGACY_/);
      }
    }
  });

  it('keeps Discord variables out of the release job', () => {
    for (const key of envKeys(services['sab-release']!) ?? []) {
      expect(key).not.toMatch(/^DISCORD_/);
    }
  });

  it('gives each service only its own database credentials', () => {
    const credentialKeys = (name: string): string[] =>
      (envKeys(services[name]!) ?? []).filter((key) => /PASSWORD$/.test(key));
    expect(credentialKeys('sab-release')).toEqual(['POSTGRES_MIGRATE_PASSWORD']);
    expect(credentialKeys('sab-server')).toEqual(['POSTGRES_PASSWORD']);
    expect(credentialKeys('sab-backup')).toEqual(['POSTGRES_BACKUP_PASSWORD']);
  });

  it('takes every secret from a variable reference, never a literal', () => {
    for (const [name, service] of Object.entries(services)) {
      const env = asMap(service['environment'], `${name} environment`);
      for (const [key, value] of Object.entries(env)) {
        if (/PASSWORD|TOKEN|SECRET/.test(key)) {
          expect(stringOf(value, `${name} ${key}`), `${name} ${key}`).toMatch(/^\$\{[A-Z0-9_]+\}$/);
        }
      }
    }
  });

  it('makes the server wait for the release job with the map form', () => {
    for (const name of ['sab-server', 'sab-backup']) {
      const dependsOn = asMap(services[name]!['depends_on'], `${name} depends_on`);
      expect(asMap(dependsOn['sab-release'], 'sab-release')['condition']).toBe(
        'service_completed_successfully',
      );
    }
  });

  it('sets restart policies, signals and the readiness healthcheck', () => {
    expect(services['sab-release']!['restart']).toBe('no');
    expect(services['sab-server']!['restart']).toBe('unless-stopped');
    expect(services['sab-backup']!['restart']).toBe('unless-stopped');
    expect(services['sab-server']!['stop_signal']).toBe('SIGTERM');
    expect(services['sab-server']!['stop_grace_period']).toBe('45s');
    const health = asMap(services['sab-server']!['healthcheck'], 'healthcheck');
    expect(health['start_period']).toBeDefined();
    expect(health['start_interval']).toBeDefined();
  });

  it('builds locally and never pulls', () => {
    for (const [name, service] of Object.entries(services)) {
      expect(service['build'], `${name} build`).toBeDefined();
      expect(service['pull_policy'], `${name} pull_policy`).toBe('never');
    }
  });

  it('limits CPU only through deploy.resources.limits', () => {
    for (const [name, service] of Object.entries(services)) {
      const limits = asMap(
        asMap(asMap(service['deploy'], `${name} deploy`)['resources'], 'resources')['limits'],
        'limits',
      );
      expect(limits['cpus'], `${name} limits.cpus`).toBeDefined();
    }
  });

  it('never references the local-only smoke stack', () => {
    expect(text).not.toContain('local-smoke');
  });
});
