import { StandardSchemaValidationPipe, type ArgumentMetadata } from '@nestjs/common';
import { ErrorCode } from '@sab/shared';
import { CommandError } from '../filters/discord-exception.filter.js';

type Schema = NonNullable<ArgumentMetadata['schema']>;

/**
 * Validates a command's options with a schema from `@sab/shared`:
 * `@Options(new StandardSchemaOptionsPipe(MySchema)) options: MyDto`.
 *
 * It is Nest's own Standard Schema pipe with the schema supplied at the
 * decorator instead of on the parameter metadata, so what the schema outputs
 * (fields it does not declare stripped, defaults and coercions applied) is what
 * the handler receives. Invalid input becomes `VALIDATION_FAILED`, which the
 * exception filter answers with the localised catalog text; the issues are not
 * shown to the user.
 */
export class StandardSchemaOptionsPipe extends StandardSchemaValidationPipe {
  constructor(private readonly schema: Schema) {
    super({
      // Necord options come from a custom parameter decorator.
      validateCustomDecorators: true,
      exceptionFactory: () => new CommandError(ErrorCode.VALIDATION_FAILED),
    });
  }

  override transform<T>(value: T, metadata: ArgumentMetadata): Promise<T> {
    return super.transform(value, { ...metadata, schema: this.schema });
  }
}
