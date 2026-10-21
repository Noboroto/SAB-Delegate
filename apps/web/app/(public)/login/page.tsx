import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { getTranslations } from 'next-intl/server';
import { MeSchema } from '@sab/shared';
import { LoginCard } from '@/components/auth/login-card';
import { serverFetch } from '@/lib/api/server-fetch';
import { safeNextPath } from '@/lib/auth/safe-next';

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('login');
  return { title: t('title') };
}

async function isSignedIn(): Promise<boolean> {
  try {
    await serverFetch('/api/me', { parser: MeSchema, onUnauthenticated: 'throw' });
    return true;
  } catch {
    // Signed out, or the server is unreachable: either way the page offers the
    // button rather than an error, and the click reports a real failure.
    return false;
  }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string | string[] }>;
}) {
  const next = safeNextPath((await searchParams).next);
  if (await isSignedIn()) redirect(next);

  return (
    <main
      id="main"
      className="page-main"
      style={{ display: 'grid', placeItems: 'center', flex: 1 }}
    >
      <LoginCard next={next} />
    </main>
  );
}
