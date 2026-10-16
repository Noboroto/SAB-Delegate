/**
 * The page to show instead when the one asked for is past the end (after a
 * bulk delete or a reset the list is shorter than the link remembers);
 * `undefined` when the page is fine.
 */
export function lastPageIfPastEnd(page: {
  items: readonly unknown[];
  pagination: { page: number; pageSize: number; total: number };
}): number | undefined {
  const { page: current, pageSize, total } = page.pagination;
  if (page.items.length > 0 || current <= 1) return undefined;
  return Math.max(1, Math.ceil(total / pageSize));
}
