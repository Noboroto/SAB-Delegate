import { describe, expect, it } from 'vitest';
import { requireDatabaseUrl } from '../vitest-test-database.mjs';

// Runs through `pnpm test:db` only. It is also what makes TEST_REQUIRE_DB=1
// observable: vitest runs the global setup only when at least one spec exists,
// and the setup is where a missing database fails the run.
describe('test database harness', () => {
  it('hands every run its own migrated schema', () => {
    const { url, schema } = requireDatabaseUrl();
    expect(schema).toMatch(/^test_[0-9a-z]+_[0-9a-f]{6}$/);
    expect(new URL(url).searchParams.get('schema')).toBe(schema);
    expect(new URL(url).pathname).toMatch(/_test$/);
  });
});
