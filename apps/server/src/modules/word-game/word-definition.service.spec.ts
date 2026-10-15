import { Logger } from '@nestjs/common';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DefinitionFetch } from './word-definition.sources.js';
import { WordDefinitionService } from './word-definition.service.js';

type Route = { status?: number; json?: unknown; text?: string } | Error;

/** A fake network: each source host answers from `routes`; unknown hosts 404. */
function network(routes: Partial<Record<'en' | 'vi' | 'datamuse' | 'mymemory', Route>>) {
  const hostOf = (url: string) => {
    if (url.includes('en.wiktionary.org')) return 'en';
    if (url.includes('vi.wiktionary.org')) return 'vi';
    if (url.includes('datamuse')) return 'datamuse';
    return 'mymemory';
  };
  const fetcher = vi.fn<DefinitionFetch>((url) => {
    const route = routes[hostOf(url)];
    if (route instanceof Error) return Promise.reject(route);
    const status = route?.status ?? (route === undefined ? 404 : 200);
    return Promise.resolve(
      new Response(route?.text ?? JSON.stringify(route?.json ?? null), { status }),
    );
  });
  const calls = (host: string) => fetcher.mock.calls.filter(([url]) => hostOf(url) === host).length;
  return { fetcher, calls };
}

const EN = {
  json: { en: [{ partOfSpeech: 'Noun', definitions: [{ definition: 'An act of running.' }] }] },
};
const VI = { text: '{{-eng-}}\n{{-verb-}}\n# Chạy.\n{{-noun-}}\n# Sự chạy.' };

beforeEach(() => {
  vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('WordDefinitionService', () => {
  it('joins the English sense with the Vietnamese meaning of the same part of speech', async () => {
    const { fetcher, calls } = network({ en: EN, vi: VI });
    await expect(new WordDefinitionService(fetcher).define('run')).resolves.toEqual({
      english: { partOfSpeech: 'noun', definition: 'An act of running.', source: 'wiktionary' },
      vietnamese: { meaning: 'Sự chạy.', source: 'wiktionary' },
    });
    expect(calls('datamuse') + calls('mymemory')).toBe(0);
  });

  it('asks Datamuse without Wiktionary and machine-translates without a Vietnamese page', async () => {
    const { fetcher } = network({
      datamuse: { json: [{ word: 'aasvogel', defs: ['n\tVulture.'] }] },
      mymemory: { json: { responseStatus: 200, responseData: { translatedText: 'Kền kền.' } } },
    });
    await expect(new WordDefinitionService(fetcher).define('aasvogel')).resolves.toEqual({
      english: { partOfSpeech: 'noun', definition: 'Vulture.', source: 'datamuse' },
      vietnamese: { meaning: 'Kền kền.', source: 'machine' },
    });
  });

  it('serves a word played again from memory, and shares one lookup between concurrent plays', async () => {
    const { fetcher } = network({ en: EN, vi: VI });
    const service = new WordDefinitionService(fetcher);
    await Promise.all([service.define('run'), service.define('run')]);
    await service.define('run');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('skips the meaning of new words past four lookups at once, but still serves cached ones', async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const { fetcher } = network({ en: EN, vi: VI });
    const slow = vi.fn<DefinitionFetch>(async (url, init) => {
      if (url.includes('/hold')) await gate;
      return fetcher(url, init);
    });
    const service = new WordDefinitionService(slow);
    await service.define('run');

    const held = ['a', 'b', 'c', 'd'].map((word) => service.define(`hold${word}`));
    await expect(service.define('fresh')).resolves.toBeNull();
    expect(slow.mock.calls.some(([url]) => url.includes('fresh'))).toBe(false);
    await expect(service.define('run')).resolves.not.toBeNull();
    // A word already being looked up joins that lookup instead of being skipped.
    const joined = service.define('holda');

    release();
    await expect(joined).resolves.not.toBeNull();
    await Promise.all(held);
    await expect(service.define('fresh')).resolves.not.toBeNull();
  });

  it('gives nothing when every source is down, and asks again next time', async () => {
    const { fetcher } = network({
      en: new Error('ECONNRESET'),
      vi: { status: 503 },
      datamuse: new Error('timeout'),
    });
    const service = new WordDefinitionService(fetcher);
    await expect(service.define('run')).resolves.toBeNull();
    await expect(service.define('run')).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(6);
  });

  it('remembers a word no source knows, so it is not asked again', async () => {
    const { fetcher } = network({ datamuse: { json: [] } });
    const service = new WordDefinitionService(fetcher);
    await expect(service.define('zzqx')).resolves.toBeNull();
    await expect(service.define('zzqx')).resolves.toBeNull();
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it('keeps the English part when the translation is refused', async () => {
    const { fetcher } = network({
      en: EN,
      mymemory: { json: { responseStatus: 403, responseData: { translatedText: 'x' } } },
    });
    await expect(new WordDefinitionService(fetcher).define('run')).resolves.toEqual({
      english: { partOfSpeech: 'noun', definition: 'An act of running.', source: 'wiktionary' },
    });
  });

  it('asks again after a short while when a source failed but something was found', async () => {
    vi.useFakeTimers({ toFake: ['performance', 'Date', 'setTimeout', 'clearTimeout'] });
    // lru-cache reads an entry stamped at time 0 as one that never expires.
    vi.advanceTimersByTime(1000);
    try {
      const { fetcher, calls } = network({ en: new Error('timeout'), vi: VI });
      const service = new WordDefinitionService(fetcher);
      await expect(service.define('run')).resolves.toEqual({
        vietnamese: { meaning: 'Chạy.', source: 'wiktionary' },
      });
      await service.define('run');
      expect(calls('en')).toBe(1);
      vi.advanceTimersByTime(11 * 60 * 1000);
      await service.define('run');
      expect(calls('en')).toBe(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('stops asking for translations for a while once the quota is refused', async () => {
    const { fetcher, calls } = network({
      en: EN,
      mymemory: { json: { responseStatus: 429, quotaFinished: true } },
    });
    const service = new WordDefinitionService(fetcher);
    await service.define('run');
    await service.define('walk');
    expect(calls('mymemory')).toBe(1);
  });

  it('sends a User-Agent and a timeout with every request', async () => {
    const { fetcher } = network({ en: EN, vi: VI });
    await new WordDefinitionService(fetcher).define('run');
    for (const [, init] of fetcher.mock.calls) {
      expect(new Headers(init.headers).get('User-Agent')).toContain('SAB-Delegate');
      expect(init.signal).toBeInstanceOf(AbortSignal);
    }
  });
});
