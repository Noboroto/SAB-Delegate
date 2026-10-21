'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { App } from 'antd';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';

interface UnsavedGuard {
  /** Called by a form being edited, under its own id; it clears itself when the form goes away. */
  setDirty: (id: string, dirty: boolean) => void;
  /** Runs `go` at once, or after the person agrees to lose the unsaved changes. */
  confirmLeave: (go: () => void) => void;
}

/** Outside a provider (a form shown on its own) nothing is guarded. */
const GuardContext = createContext<UnsavedGuard>({
  setDirty: () => undefined,
  confirmLeave: (go) => go(),
});

/** The internal link a click landed on, when following it would leave the current page state. */
function internalHref(event: MouseEvent): string | undefined {
  if (event.defaultPrevented || event.button !== 0) return undefined;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return undefined;
  const anchor =
    event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
  if (anchor === null || (anchor.target !== '' && anchor.target !== '_self')) return undefined;
  if (anchor.hasAttribute('download')) return undefined;
  const url = new URL(anchor.href, window.location.href);
  if (url.origin !== window.location.origin) return undefined;
  const next = `${url.pathname}${url.search}`;
  return next === `${window.location.pathname}${window.location.search}` ? undefined : next;
}

/**
 * Asks before the person leaves a page with unsaved changes: for a tab
 * switch (through `confirmLeave`), a click on an in-app link, and, through the
 * browser's own prompt, a reload or a closed tab. The browser's back button
 * cannot be held back by the app router.
 */
export function UnsavedGuardProvider({ children }: { children: ReactNode }) {
  const t = useTranslations('web-common.unsaved');
  const { modal } = App.useApp();
  const router = useRouter();
  // Several forms can sit on one page: it is dirty while any of them is.
  const dirtyIds = useRef(new Set<string>());
  const [dirty, setDirtyState] = useState(false);

  const setDirty = useCallback((id: string, isDirty: boolean) => {
    if (isDirty) dirtyIds.current.add(id);
    else dirtyIds.current.delete(id);
    setDirtyState(dirtyIds.current.size > 0);
  }, []);

  const confirmLeave = useCallback(
    (go: () => void) => {
      if (!dirty) {
        go();
        return;
      }
      modal.confirm({
        title: t('title'),
        content: t('content'),
        okText: t('leave'),
        cancelText: t('stay'),
        okButtonProps: { danger: true },
        onOk: go,
      });
    },
    [dirty, modal, t],
  );

  useEffect(() => {
    if (!dirty) return undefined;
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    const onClick = (event: MouseEvent) => {
      const href = internalHref(event);
      if (href === undefined) return;
      event.preventDefault();
      event.stopPropagation();
      confirmLeave(() => router.push(href));
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    // Capture phase: runs before the link component's own handler can start the navigation.
    document.addEventListener('click', onClick, true);
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('click', onClick, true);
    };
  }, [dirty, confirmLeave, router]);

  const value = useMemo(() => ({ setDirty, confirmLeave }), [setDirty, confirmLeave]);
  return <GuardContext.Provider value={value}>{children}</GuardContext.Provider>;
}

function useGuard(): UnsavedGuard {
  return useContext(GuardContext);
}

/** Tab switches go through this so unsaved changes are not lost without asking. */
export function useConfirmLeave(): UnsavedGuard['confirmLeave'] {
  return useGuard().confirmLeave;
}

/**
 * Tells the page that this form holds changes that are not saved, so a link
 * click, a tab switch or a reload asks first. Pass `form.isFieldsTouched()` or
 * any other "differs from what is stored" flag; no provider means no guard.
 */
export function useUnsavedChanges(dirty: boolean): void {
  const { setDirty } = useGuard();
  const id = useId();
  useEffect(() => {
    setDirty(id, dirty);
    return () => setDirty(id, false);
  }, [dirty, id, setDirty]);
}
