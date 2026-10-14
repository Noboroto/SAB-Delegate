import { PageLoading } from '@/components/ui/page-loading';

// Wraps the page under the server layout, not the layout: the layout decides
// "not found" and must finish before anything is sent, or the answer would be a
// 200 with a not-found screen inside.
export default function GuildLoading() {
  return <PageLoading />;
}
