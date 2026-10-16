import { z } from 'zod';

/** An https URL without credentials, query or fragment: the base of an OpenAI-compatible API. */
export const LlmBaseUrlSchema = z
  .string()
  .trim()
  .max(300)
  .refine((value) => {
    try {
      const url = new URL(value);
      return (
        url.protocol === 'https:' &&
        url.username === '' &&
        url.password === '' &&
        url.search === '' &&
        url.hash === ''
      );
    } catch {
      return false;
    }
  });

/** What the dashboard shows; the API key itself never leaves the server. */
export const LlmSettingsSchema = z.object({
  /**
   * Whether the asked server is the admin server, the only one where the LLM is
   * configured. False: every other field is empty.
   */
  adminServer: z.boolean(),
  /** False while the server has no LLM_KEY_SECRET: nothing can be saved. */
  available: z.boolean(),
  enabled: z.boolean(),
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  /** Last four characters of the stored key, to recognise it. */
  keyLast4: z.string().nullable(),
});

export type LlmSettings = z.infer<typeof LlmSettingsSchema>;

/**
 * A save or a connection test. `apiKey` may be left out to keep the stored key,
 * but only while `baseUrl` stays the same: a stored key never goes to a new host.
 */
export const LlmSettingsInputSchema = z.object({
  baseUrl: LlmBaseUrlSchema,
  model: z.string().trim().min(1).max(200),
  enabled: z.boolean(),
  // Long enough that its last four characters, shown back, give nothing away.
  apiKey: z.string().trim().min(12).max(500).optional(),
});

export type LlmSettingsInput = z.infer<typeof LlmSettingsInputSchema>;

const LlmFailureReasonSchema = z.enum([
  'unreachable',
  'blocked',
  'unauthorized',
  'provider_quota',
  'bad_response',
]);

export const LlmTestResultSchema = z.object({
  ok: z.boolean(),
  /** Why the test failed; the provider's own error text is never passed on. */
  reason: LlmFailureReasonSchema.optional(),
});

export type LlmTestResult = z.infer<typeof LlmTestResultSchema>;

/**
 * Asks an endpoint which models it serves. `apiKey` may be left out to use the
 * stored key, but only while `baseUrl` is the address that key was saved for.
 */
export const LlmModelsRequestSchema = z.object({
  baseUrl: LlmBaseUrlSchema,
  apiKey: LlmSettingsInputSchema.shape.apiKey,
});

export type LlmModelsRequest = z.infer<typeof LlmModelsRequestSchema>;

export const LlmModelsResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), models: z.array(z.string()) }),
  z.object({ ok: z.literal(false), reason: LlmFailureReasonSchema }),
]);

export type LlmModelsResult = z.infer<typeof LlmModelsResultSchema>;
