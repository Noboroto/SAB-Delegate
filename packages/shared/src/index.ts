// Single import surface for '@sab/shared': add exports here instead of letting
// consumers reach into internal paths.

// The single place zod is imported. Consumers take `z` from '@sab/shared' so one
// zod instance (and any `z.config` set on it) serves every schema.
export { z } from 'zod';

export { ErrorCode, ErrorCodeSchema } from './errors/error-code.js';
export { partialWithoutDefaults } from './utils/partial-without-defaults.js';
export { isValidMonthDay } from './utils/month-day.js';
export { SnowflakeSchema, type Snowflake } from './schemas/snowflake.js';
export {
  PAGE_SIZE_DEFAULT,
  PAGE_SIZE_MAX,
  PaginatedSchema,
  PaginationQuerySchema,
  PaginationSchema,
} from './schemas/pagination.js';
export { ListQuerySchema, SEARCH_MAX_LENGTH } from './schemas/list-query.js';
export {
  BIRTHDAY_NAME_PLACEHOLDER,
  BIRTHDAY_WISHES,
  renderBirthdayWish,
} from './constants/birthday-wishes.js';
export { REACTION_PHRASES } from './constants/reaction-phrases.js';
export { QUEUES, type QueueName } from './constants/queues.js';
export { MESSAGE_MAX_LENGTH } from './constants/limits.js';
