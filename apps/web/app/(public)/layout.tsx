import { PublicChrome } from '@/components/layout/public-chrome';

/** Pages shown before sign-in: a bar with the language and theme switchers, then the content. */
export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100dvh' }}>
      <PublicChrome />
      <div style={{ display: 'flex', flex: 1, flexDirection: 'column' }}>{children}</div>
    </div>
  );
}
