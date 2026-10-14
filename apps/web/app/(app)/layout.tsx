import { MeSchema } from '@sab/shared';
import { AppFrame } from '@/components/layout/app-frame';
import { serverFetch } from '@/lib/api/server-fetch';

/**
 * Everything behind the login. The check is a real call to the server, which
 * is the only judge of the cookie: a 401 redirects to the login page. (The
 * proxy's cookie test is only a shortcut for visitors with no cookie at all.)
 */
export default async function SignedInLayout({ children }: { children: React.ReactNode }) {
  await serverFetch('/api/me', { parser: MeSchema });
  return <AppFrame>{children}</AppFrame>;
}
