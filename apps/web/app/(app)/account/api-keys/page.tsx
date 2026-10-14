import type { Metadata } from 'next';
import { getTranslations } from 'next-intl/server';
import { ApiKeysPage } from '@/components/api-keys/api-keys-page';
import { serverFetch } from '@/lib/api/server-fetch';
import { ApiKeyListSchema } from '@/lib/api-keys/api-keys-api';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('web-api-keys');
  return { title: t('pageTitle') };
}

export default async function ApiKeysRoute() {
  const keys = await serverFetch('/api/me/api-keys', { parser: ApiKeyListSchema });
  return <ApiKeysPage keys={keys} />;
}
