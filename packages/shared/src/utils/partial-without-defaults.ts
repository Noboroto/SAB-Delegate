import { z } from 'zod';

type Unwrapped<T extends z.core.SomeType> =
  T extends z.ZodDefault<infer Inner extends z.core.SomeType>
    ? Unwrapped<Inner>
    : T extends z.ZodPrefault<infer Inner extends z.core.SomeType>
      ? Unwrapped<Inner>
      : T extends z.ZodOptional<infer Inner extends z.core.SomeType>
        ? Unwrapped<Inner>
        : T;

type PartialWithoutDefaults<Shape extends z.ZodRawShape> = z.ZodObject<
  { [Key in keyof Shape]: z.ZodOptional<Unwrapped<Shape[Key]>> },
  z.core.$strip
>;

/**
 * `.partial()` keeps a field's `.default()`, so a PATCH body that leaves the
 * field out is parsed as "set it to the default" and wipes stored data. Here
 * an absent field stays absent and a present one is still validated.
 *
 * Object-level refinements are not carried over: the result is a new object.
 */
export function partialWithoutDefaults<Shape extends z.ZodRawShape>(
  schema: z.ZodObject<Shape>,
): PartialWithoutDefaults<Shape> {
  const shape: Record<string, z.core.SomeType> = {};
  for (const [key, field] of Object.entries(schema.shape)) {
    let inner: z.core.SomeType = field;
    while (
      inner instanceof z.ZodDefault ||
      inner instanceof z.ZodPrefault ||
      inner instanceof z.ZodOptional
    ) {
      inner = inner.unwrap();
    }
    shape[key] = z.optional(inner);
  }
  // The key-by-key mapping above is what the mapped type describes; TypeScript
  // cannot see through Object.entries.
  return z.object(shape) as unknown as PartialWithoutDefaults<Shape>;
}
