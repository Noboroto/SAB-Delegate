import 'reflect-metadata';
import { randomBytes } from 'node:crypto';
import {
  Controller,
  Delete,
  Get,
  Patch,
  Post,
  RequestMethod,
  UseGuards,
  type Type,
} from '@nestjs/common';
import { GUARDS_METADATA, METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { SessionGuard } from './auth/session.guard.js';
import { ManageGuildGuard } from './common/guild-access/manage-guild.guard.js';

// Routes that deliberately have no login: the container probes. Better Auth's
// `/api/auth/*` is a raw Fastify route outside Nest and never appears here.
const PUBLIC_ROUTES: ReadonlySet<string> = new Set(['/health', '/health/live']);
// The one route outside /api: the MCP endpoint, which takes a bearer API key and
// checks it inside the handler (no cookie, so no SessionGuard). Only its own
// controller may sit there, and every tool call it serves re-checks Manage Server.
const BEARER_ROUTES: ReadonlyMap<string, string> = new Map([['/mcp', 'McpController']]);
const GUILD_SCOPED = /^\/api\/guilds\/:/;
const GUILD_PARAM = /^\/api\/guilds\/:guildId(\/|$)/;

type Route = { path: string; method: string; guards: readonly unknown[]; owner: string };

function pathsOf(target: object): string[] {
  const value: unknown = Reflect.getMetadata(PATH_METADATA, target);
  const list = Array.isArray(value)
    ? (value as string[])
    : [typeof value === 'string' ? value : ''];
  return list.map((part) => part.replace(/^\/+|\/+$/g, ''));
}

function guardsOf(target: object): unknown[] {
  return (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
}

function routesOf(controller: Type): Route[] {
  const classGuards = guardsOf(controller);
  const routes: Route[] = [];
  for (const name of Object.getOwnPropertyNames(controller.prototype)) {
    const handler = (controller.prototype as Record<string, unknown>)[name];
    if (typeof handler !== 'function') continue;
    if (Reflect.getMetadata(METHOD_METADATA, handler) === undefined) continue;
    for (const base of pathsOf(controller)) {
      for (const sub of pathsOf(handler)) {
        routes.push({
          path: `/${[base, sub].filter((part) => part !== '').join('/')}`,
          method: String(Reflect.getMetadata(METHOD_METADATA, handler)),
          guards: [...classGuards, ...guardsOf(handler)],
          owner: `${controller.name}.${name}`,
        });
      }
    }
  }
  return routes;
}

type Guards = { session: unknown; manageGuild: unknown };
const GUARDS: Guards = { session: SessionGuard, manageGuild: ManageGuildGuard };

/** Why a route breaks the access rule; empty for a route that follows it. */
function violationsOf(route: Route, guards: Guards = GUARDS): string[] {
  const label = `${route.owner} ${route.path}`;
  if (PUBLIC_ROUTES.has(route.path)) return [];
  const bearerOwner = BEARER_ROUTES.get(route.path);
  if (bearerOwner !== undefined) {
    return route.owner.startsWith(`${bearerOwner}.`)
      ? []
      : [`${label}: ${route.path} belongs to ${bearerOwner}`];
  }
  if (!route.path.startsWith('/api/')) return [`${label}: REST routes live under /api`];
  if (route.path.startsWith('/api/auth/')) return [];
  if (GUILD_SCOPED.test(route.path)) {
    const problems: string[] = [];
    if (!GUILD_PARAM.test(route.path)) problems.push(`${label}: the server id must be :guildId`);
    if (!route.guards.includes(guards.manageGuild))
      problems.push(`${label}: missing ManageGuildGuard`);
    return problems;
  }
  return route.guards.includes(guards.session) || route.guards.includes(guards.manageGuild)
    ? []
    : [`${label}: missing SessionGuard`];
}

function collectControllers(root: Type): Type[] {
  const seen = new Set<unknown>();
  const controllers = new Set<Type>();
  const visit = (module: unknown): void => {
    if (module === undefined || seen.has(module)) return;
    seen.add(module);
    const dynamic = module as { module?: Type; imports?: unknown[]; controllers?: Type[] };
    const target = dynamic.module ?? (module as Type);
    if (typeof target !== 'function') return;
    for (const controller of (Reflect.getMetadata('controllers', target) ?? []) as Type[])
      controllers.add(controller);
    for (const controller of dynamic.controllers ?? []) controllers.add(controller);
    for (const imported of (Reflect.getMetadata('imports', target) ?? []) as unknown[])
      visit(imported);
    for (const imported of dynamic.imports ?? []) visit(imported);
  };
  visit(root);
  return [...controllers];
}

describe('REST route coverage', () => {
  let controllers: Type[];
  let appGuards: Guards;

  beforeAll(async () => {
    // The module graph is fixed when AppModule is defined, so it is imported
    // again with the REST API switched on.
    const secret = () => randomBytes(24).toString('hex');
    vi.stubEnv('APP_URL', 'https://bot.example.test');
    vi.stubEnv('DISCORD_CLIENT_SECRET', secret());
    vi.stubEnv('BETTER_AUTH_SECRET', secret());
    vi.stubEnv('MIGRATION_PENDING', '');
    vi.resetModules();
    const [{ AppModule }, session, manage] = await Promise.all([
      import('./app.module.js'),
      import('./auth/session.guard.js'),
      import('./common/guild-access/manage-guild.guard.js'),
    ]);
    controllers = collectControllers(AppModule);
    // The fresh import has its own guard classes; identity is what is compared.
    appGuards = { session: session.SessionGuard, manageGuild: manage.ManageGuildGuard };
  });

  afterAll(() => {
    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it('finds the application controllers, the caller routes among them', () => {
    const paths = controllers.flatMap(routesOf).map((route) => `${route.method}:${route.path}`);
    expect(paths.length).toBeGreaterThan(2);
    expect(paths).toContain(`${String(RequestMethod.GET)}:/api/me`);
    expect(paths).toContain(`${String(RequestMethod.GET)}:/api/guilds`);
    expect(paths).toContain(`${String(RequestMethod.GET)}:/health`);
    expect(paths).toContain(`${String(RequestMethod.POST)}:/mcp`);
  });

  it('guards every route under /api/guilds/:guildId with ManageGuildGuard and every other /api route with a login', () => {
    const violations = controllers
      .flatMap(routesOf)
      .flatMap((route) => violationsOf(route, appGuards));
    expect(violations).toEqual([]);
  });

  describe('the check itself', () => {
    const violationsOfController = (controller: Type): string[] =>
      routesOf(controller).flatMap((route) => violationsOf(route));

    it('fails a server-scoped route that has no ManageGuildGuard', () => {
      @Controller('api/guilds/:guildId/notes')
      class Unguarded {
        @Get()
        list(): void {}
      }
      expect(violationsOfController(Unguarded)).toEqual([
        expect.stringContaining('missing ManageGuildGuard'),
      ]);
    });

    it('fails a server-scoped route guarded only by the login', () => {
      @Controller('api/guilds/:guildId/notes')
      @UseGuards(SessionGuard)
      class LoginOnly {
        @Delete(':id')
        remove(): void {}
      }
      expect(violationsOfController(LoginOnly)).toEqual([
        expect.stringContaining('missing ManageGuildGuard'),
      ]);
    });

    it('accepts the guard on the class or on the method', () => {
      @Controller('api/guilds/:guildId/a')
      @UseGuards(ManageGuildGuard)
      class OnClass {
        @Get()
        list(): void {}
        @Post()
        create(): void {}
      }
      @Controller('api/guilds/:guildId/b')
      class OnMethod {
        @Patch(':id')
        @UseGuards(ManageGuildGuard)
        update(): void {}
      }
      expect(violationsOfController(OnClass)).toEqual([]);
      expect(violationsOfController(OnMethod)).toEqual([]);
    });

    it('fails one unguarded method next to a guarded one', () => {
      @Controller('api/guilds/:guildId/mixed')
      class Mixed {
        @Get()
        @UseGuards(ManageGuildGuard)
        read(): void {}
        @Post()
        write(): void {}
      }
      expect(violationsOfController(Mixed)).toEqual([expect.stringContaining('Mixed.write')]);
    });

    it('fails a server route whose id parameter is not :guildId, which the guard reads', () => {
      @Controller('api/guilds/:id/notes')
      @UseGuards(ManageGuildGuard)
      class WrongParam {
        @Get()
        list(): void {}
      }
      expect(violationsOfController(WrongParam)).toEqual([
        expect.stringContaining('must be :guildId'),
      ]);
    });

    it('fails an /api route with no login and a route outside /api', () => {
      @Controller('api/things')
      class Open {
        @Get()
        list(): void {}
      }
      @Controller('things')
      class Elsewhere {
        @Get()
        list(): void {}
      }
      expect(violationsOfController(Open)).toEqual([
        expect.stringContaining('missing SessionGuard'),
      ]);
      expect(violationsOfController(Elsewhere)).toEqual([
        expect.stringContaining('live under /api'),
      ]);
    });

    it('lets /mcp belong to McpController only', () => {
      @Controller('mcp')
      class Imposter {
        @Post()
        handle(): void {}
      }
      expect(violationsOfController(Imposter)).toEqual([
        expect.stringContaining('belongs to McpController'),
      ]);
      expect(
        violationsOf({ path: '/mcp', method: '1', guards: [], owner: 'McpController.handle' }),
      ).toEqual([]);
    });

    it('leaves the probes and Better Auth alone', () => {
      @Controller('health')
      class Probe {
        @Get()
        check(): void {}
      }
      expect(violationsOfController(Probe)).toEqual([]);
      expect(
        violationsOf({ path: '/api/auth/callback/discord', method: '0', guards: [], owner: 'x' }),
      ).toEqual([]);
    });
  });
});
