/** Short, stack-free text that is safe to show to the invoking user. */
export const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);
