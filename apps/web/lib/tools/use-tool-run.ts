'use client';

import { useCallback, useRef, useState } from 'react';
import { App } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { useApiMutation, type MutationResult } from '@/lib/api/mutations';

interface SubmitOptions {
  /** The call changes the server: the page re-reads its state afterwards. */
  refresh?: boolean;
  /** Said as a toast once the call succeeded. */
  success?: string;
}

/**
 * Runs one tool call at a time and keeps its answer for the form to show.
 * `submit(undefined)` is a form the schema rejected: nothing is sent and the
 * person is told, instead of a click that seems to do nothing. `retry` repeats
 * the last call as it was made; offer it for reads only, never for a post.
 */
export function useToolRun<TVars, TData>(call: (vars: TVars) => Promise<TData>) {
  const t = useTranslations('web-tools');
  const { message } = App.useApp();
  const router = useRouter();
  const mutation = useApiMutation(call);
  const { run, reset } = mutation;
  const [result, setResult] = useState<TData | undefined>(undefined);
  // What the last call was asked with, so a failed read can be asked again as it was.
  const last = useRef<{ vars: TVars | undefined; options: SubmitOptions } | undefined>(undefined);

  const submit = useCallback(
    async (
      vars: TVars | undefined,
      options: SubmitOptions = {},
    ): Promise<MutationResult<TData> | undefined> => {
      last.current = { vars, options };
      if (vars === undefined) {
        void message.error(t('common.invalidForm'));
        return undefined;
      }
      setResult(undefined);
      const outcome = await run(vars);
      if (outcome?.ok !== true) return outcome;
      setResult(outcome.data);
      if (options.refresh === true) router.refresh();
      if (options.success !== undefined) void message.success(options.success);
      return outcome;
    },
    [message, router, run, t],
  );

  const retry = useCallback(
    () =>
      last.current === undefined ? undefined : submit(last.current.vars, last.current.options),
    [submit],
  );

  const clear = useCallback(() => {
    setResult(undefined);
    reset();
  }, [reset]);

  return { submit, retry, pending: mutation.pending, error: mutation.error, result, clear };
}

/** What a finished destructive flow does: re-read the page and say it worked. */
export function useWriteDone() {
  const { message } = App.useApp();
  const router = useRouter();
  return useCallback(
    (text: string) => {
      router.refresh();
      void message.success(text);
    },
    [message, router],
  );
}
