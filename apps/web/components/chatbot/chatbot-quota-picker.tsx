'use client';

import { Button } from 'antd';
import { useTranslations } from 'next-intl';
import { ChatbotQuotaPageSchema, type ChatbotQuotaRow } from '@sab/shared';
import { ErrorAlert } from '@/components/data/error-alert';
import { useLookup } from '@/lib/discord/use-lookup';
import { guildApiPath } from '@/lib/guild-path';

/**
 * The actions for a member picked by name. The member may be on another page
 * of the table, so their row is read from the server first: a limit dialog
 * opened without it would offer the default and replace an own limit unseen.
 * Mounted per member (keyed by the caller), so a read never shows the previous
 * member's answer.
 */
export function ChatbotQuotaPicker({
  guildId,
  userId,
  pageRow,
  onOpen,
}: {
  guildId: string;
  userId: string;
  /** The member's row when it is on the page already shown. */
  pageRow: ChatbotQuotaRow | undefined;
  onOpen: (kind: 'limit' | 'grant', row: ChatbotQuotaRow | undefined) => void;
}) {
  const t = useTranslations('web-chatbot');
  const lookup = useLookup(
    pageRow === undefined
      ? `${guildApiPath(guildId, 'chatbot', 'quota')}?page=1&pageSize=1&q=${encodeURIComponent(userId)}`
      : null,
    ChatbotQuotaPageSchema,
  );
  const row = pageRow ?? lookup.data?.items.find((item) => item.userId === userId);
  const ready = pageRow !== undefined || (lookup.data !== undefined && !lookup.loading);

  return (
    <>
      <Button disabled={!ready} onClick={() => onOpen('limit', row)}>
        {t('usage.setLimit')}
      </Button>
      <Button disabled={!ready} onClick={() => onOpen('grant', row)}>
        {t('usage.addTokens')}
      </Button>
      {lookup.error === undefined ? null : (
        <div style={{ flexBasis: '100%' }}>
          <ErrorAlert error={lookup.error} onRetry={lookup.reload} retrying={lookup.loading} />
        </div>
      )}
    </>
  );
}
