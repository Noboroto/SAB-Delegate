import '@testing-library/jest-dom/vitest';
import { afterEach, vi } from 'vitest';

/**
 * Unit tests must not reach the network. A component that catches a rejected
 * fetch hides it behind an error state, so an unrelated assertion still passes
 * and the call stays invisible: the refusal below is recorded and fails the
 * test afterwards, whoever swallowed the rejection.
 */
const blockedRequests: string[] = [];
const realFetch = globalThis.fetch;
const IN_MEMORY_SCHEME = /^(data|blob):/i;

function urlOf(input: Parameters<typeof fetch>[0]): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

globalThis.fetch = (input, init) => {
  const url = urlOf(input);
  if (IN_MEMORY_SCHEME.test(url)) return realFetch(input, init);
  blockedRequests.push(url);
  return Promise.reject(new Error(`Unmocked network call in a unit test: ${url}`));
};

afterEach(() => {
  if (blockedRequests.length === 0) return;
  const urls = [...new Set(blockedRequests)];
  blockedRequests.length = 0;
  throw new Error(
    `This test reached the network: ${urls.join(', ')}. Stub fetch or mock the module that owns the call.`,
  );
});

if (typeof window !== 'undefined') {
  // AntD reads these; happy-dom has neither.
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });

  globalThis.ResizeObserver = class ResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  };
}
