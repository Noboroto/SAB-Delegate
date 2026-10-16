'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Alert, Button, Modal } from 'antd';
import { useTranslations } from 'next-intl';
import { ErrorAlert } from '@/components/data/error-alert';
import { DryRunPreview, type DryRunPreviewState } from '@/components/data/dry-run-preview';
import type { ApiRequestError } from '@/lib/api/api-response';
import { useApiMutation } from '@/lib/api/mutations';

/** How long a plan stays good to confirm; after that the world may have changed under it. */
export const PREVIEW_TTL_MS = 2 * 60 * 1000;

interface ConfirmActionProps<TPlan, TResult> {
  /** The button that starts the flow; name the scope ("Delete 20 messages"), not just "Delete". */
  label: string;
  /**
   * Full accessible name when `label` is kept short on screen (a name or topic a
   * person typed would overflow a narrow button); the scope still reaches screen readers.
   */
  ariaLabel?: string;
  modalTitle: string;
  confirmLabel: string;
  /** The call with `dryRun`: resolves to the plan the service computed. */
  preview: () => Promise<TPlan>;
  /** The call with `confirm`: runs the real thing. Never invoked without a fresh plan on screen. */
  execute: () => Promise<TResult>;
  renderPlan: (plan: TPlan) => ReactNode;
  /** `false` keeps the confirm button off, e.g. when the plan says there is nothing to do. */
  canConfirm?: (plan: TPlan) => boolean;
  onDone?: (result: TResult) => void;
  disabled?: boolean;
  /** `false` for a public post (send, poll, edit): it needs a preview, but it destroys nothing. */
  danger?: boolean;
  previewTtlMs?: number;
  /** Draws a failed confirm in place of the generic alert, e.g. one that carries its own next step; `undefined` keeps the generic one. */
  renderError?: (error: ApiRequestError) => ReactNode;
}

/**
 * The only way a destructive call is made from the dashboard: ask the service
 * for a plan (`dryRun`), show it as returned, and run the real call only after
 * the person confirms that plan. Closing does nothing. A plan older than
 * `previewTtlMs`, or one whose confirm failed, must be reviewed again.
 */
export function ConfirmAction<TPlan, TResult>({
  label,
  ariaLabel,
  modalTitle,
  confirmLabel,
  preview,
  execute,
  renderPlan,
  canConfirm,
  onDone,
  disabled = false,
  danger = true,
  previewTtlMs = PREVIEW_TTL_MS,
  renderError,
}: ConfirmActionProps<TPlan, TResult>) {
  const t = useTranslations('web-common');
  const [open, setOpen] = useState(false);
  const [plan, setPlan] = useState<DryRunPreviewState<TPlan>>({ status: 'loading' });
  const [stale, setStale] = useState(false);
  const plannedAt = useRef(0);
  // The modal can stay mounted for its closing animation; a click then must not run anything.
  const active = useRef(false);
  // Each preview request gets a number; an answer for an older one (the modal
  // was closed or the plan re-requested meanwhile) is dropped.
  const requestId = useRef(0);
  const latest = useRef({ preview, onDone });
  latest.current = { preview, onDone };
  const execution = useApiMutation(execute);
  const resetExecution = execution.reset;

  const loadPlan = useCallback(async () => {
    const id = ++requestId.current;
    setStale(false);
    resetExecution();
    setPlan({ status: 'loading' });
    try {
      const next = await latest.current.preview();
      if (id !== requestId.current) return;
      plannedAt.current = Date.now();
      setPlan({ status: 'ready', plan: next });
    } catch (error) {
      if (id === requestId.current) setPlan({ status: 'error', error });
    }
  }, [resetExecution]);

  useEffect(() => {
    if (!open || plan.status !== 'ready') return;
    const timer = setTimeout(() => setStale(true), previewTtlMs);
    return () => clearTimeout(timer);
  }, [open, plan, previewTtlMs]);

  const start = () => {
    active.current = true;
    setOpen(true);
    void loadPlan();
  };

  const close = () => {
    if (execution.pending) return;
    active.current = false;
    requestId.current += 1;
    execution.reset();
    setOpen(false);
  };

  const confirm = async () => {
    if (!active.current || plan.status !== 'ready') return;
    if (stale || Date.now() - plannedAt.current > previewTtlMs) {
      await loadPlan();
      return;
    }
    const outcome = await execution.run(undefined);
    if (outcome === undefined) return;
    if (outcome.ok) {
      active.current = false;
      requestId.current += 1;
      setOpen(false);
      latest.current.onDone?.(outcome.data);
    } else {
      // Whatever the call failed on, the plan on screen no longer describes it.
      setStale(true);
    }
  };

  const reviewing = plan.status === 'ready' && stale;
  const confirmable = plan.status === 'ready' && (stale || canConfirm?.(plan.plan) !== false);

  return (
    <>
      <Button
        danger={danger}
        aria-label={ariaLabel}
        type={danger ? 'default' : 'primary'}
        disabled={disabled}
        onClick={start}
      >
        {label}
      </Button>
      <Modal
        open={open}
        title={modalTitle}
        onCancel={close}
        onOk={() => void confirm()}
        okText={reviewing ? t('confirm.refreshPlan') : confirmLabel}
        cancelText={t('cancel')}
        okButtonProps={{ danger: danger && !reviewing, disabled: !confirmable }}
        cancelButtonProps={{ disabled: execution.pending }}
        confirmLoading={execution.pending}
        destroyOnHidden
      >
        <div style={{ display: 'grid', gap: 12 }}>
          <DryRunPreview state={plan} renderPlan={renderPlan} onRetry={() => void loadPlan()} />
          {reviewing && execution.error === undefined ? (
            <Alert type="warning" showIcon title={t('confirm.expired')} />
          ) : null}
          {execution.error === undefined
            ? null
            : (renderError?.(execution.error) ?? <ErrorAlert error={execution.error} />)}
        </div>
      </Modal>
    </>
  );
}
