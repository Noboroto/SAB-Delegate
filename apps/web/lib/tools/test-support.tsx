import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expect, vi } from 'vitest';

export const GUILD = '1'.repeat(18);
export const CHANNEL_TEXT = '2'.repeat(18);
export const CHANNEL_VOICE = '3'.repeat(18);
const CHANNEL_CATEGORY = '4'.repeat(18);
export const ROLE_MOD = '5'.repeat(18);
const ROLE_MEMBER = '6'.repeat(18);
export const MESSAGE = '7'.repeat(18);

const LATENCY_MS = 40;

const channels = [
  { id: CHANNEL_CATEGORY, name: 'Activities', type: 4, parentId: null, position: 0 },
  { id: CHANNEL_TEXT, name: 'general', type: 0, parentId: null, position: 1 },
  { id: CHANNEL_VOICE, name: 'Voice room', type: 2, parentId: null, position: 2 },
];
const roles = [
  { id: ROLE_MOD, name: 'Moderator', color: 0, position: 2, managed: false },
  { id: ROLE_MEMBER, name: 'Regular', color: 0, position: 1, managed: false },
];

interface ApiCall {
  /** The path after `/api/guilds/<id>/`. */
  path: string;
  method: string;
  body: unknown;
  query: Record<string, string>;
}

type Handler = (call: ApiCall) => unknown;

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

/**
 * Replaces `fetch` for a tool test: the pickers' lookups are answered with
 * fixed lists, every other route with its handler's return value (a route
 * with no handler is a 404 the test then sees). `calls` holds the tool calls
 * only, in order, so a test can say how many requests a click made.
 */
export function stubToolApi(handlers: Record<string, Handler> = {}) {
  const calls: ApiCall[] = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const href =
        typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
      const url = new URL(href, 'http://localhost');
      const path = url.pathname.replace(`/api/guilds/${GUILD}/`, '');
      if (path === 'discord/channels') return json(channels);
      if (path === 'discord/roles') return json(roles);
      if (path === 'discord/members') return json([]);
      const call: ApiCall = {
        path,
        method: init?.method ?? 'GET',
        body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
        query: Object.fromEntries(url.searchParams),
      };
      calls.push(call);
      // A real call takes time; without it the first answer lands before the
      // second click, and a double click would look like two separate sends.
      await new Promise((resolve) => setTimeout(resolve, LATENCY_MS));
      const handler = handlers[path];
      return handler === undefined ? json({ code: 'INTERNAL' }, 404) : json(handler(call));
    }),
  );
  return { calls };
}

/** Opens the picker named by `label` and picks the option written `option`. */
export async function pickOption(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  await userEvent.click(await screen.findByText(option));
}

/** A missing translation is shown as its key path, which always starts with the namespace. */
export function expectNoBareKeys() {
  expect(document.body.textContent).not.toContain('web-tools');
}
