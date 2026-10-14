'use client';

import { RouteErrorState } from '@/components/ui/route-error-state';

/** The route boundary inside the signed-in frame, whose shell already provides `main`. */
export default function AppRouteError(props: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return <RouteErrorState {...props} />;
}
