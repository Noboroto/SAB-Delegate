/** Liveness for the container healthcheck: answers without touching the server or cookies. */
export function GET(): Response {
  return Response.json({ status: 'ok' }, { headers: { 'Cache-Control': 'no-store' } });
}
