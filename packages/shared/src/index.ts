// Single import surface for '@sab/shared': add exports here instead of letting
// consumers reach into internal paths.

// The single place zod is imported. Consumers take `z` from '@sab/shared' so one
// zod instance (and any `z.config` set on it) serves every schema.
export { z } from 'zod';
