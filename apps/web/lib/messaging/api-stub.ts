import { vi } from 'vitest';

export const GUILD = '1'.repeat(18);
export const GENERAL = '3'.repeat(18);
export const RANDOM = '4'.repeat(18);
export const MESSAGE_LINK = `https://discord.com/channels/${GUILD}/${GENERAL}/${'7'.repeat(18)}`;

const CHANNELS = [
  { id: GENERAL, name: 'general', type: 0, parentId: null, position: 0 },
  { id: RANDOM, name: 'random', type: 0, parentId: null, position: 1 },
];

type Handler = (path: string, init: RequestInit | undefined) => unknown;

/**
 * Stands in for the server in a component test: the channel list is always
 * answered, every other call goes to `handler`, whose result (or the promise of
 * one) becomes the JSON body.
 */
export function stubApi(handler: Handler) {
  const mock = vi.fn((input: string, init?: RequestInit) => {
    if (input.endsWith('/discord/channels')) {
      return Promise.resolve(new Response(JSON.stringify(CHANNELS)));
    }
    return Promise.resolve(handler(input, init)).then((body) => new Response(JSON.stringify(body)));
  });
  vi.stubGlobal('fetch', mock);
  return mock;
}

/** The JSON body of a request, or `undefined` when it had none. */
export function bodyOf(init: RequestInit | undefined): unknown {
  return typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined;
}

export interface RecordedWrite {
  path: string;
  method: string | undefined;
  body: unknown;
}

/** The calls other than the channel list, with their JSON bodies read back. */
export function writesOf(mock: ReturnType<typeof stubApi>): RecordedWrite[] {
  return mock.mock.calls
    .filter(([path]) => !path.endsWith('/discord/channels'))
    .map(([path, init]) => ({
      path,
      method: init?.method,
      body: bodyOf(init),
    }));
}

export function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}
