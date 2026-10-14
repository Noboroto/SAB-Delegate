'use client';

import { RouteErrorState } from '@/components/ui/route-error-state';

/**
 * The boundary of routes outside the signed-in frame, so it brings its own
 * `main`; inside the frame (`(app)/error.tsx`) the shell already has one.
 */
export default function RouteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <main id="main" className="page-main">
      <RouteErrorState {...props} />
    </main>
  );
}
