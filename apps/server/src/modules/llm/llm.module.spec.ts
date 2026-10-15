import 'reflect-metadata';
import { Test } from '@nestjs/testing';
import { describe, expect, it } from 'vitest';
import { LlmModule } from './llm.module.js';
import { LLM_ENV, LlmService } from './llm.service.js';

describe('LlmModule', () => {
  it('resolves its service through the container', async () => {
    // Everything outside the module (the database, the audit trail) is a
    // stand-in; the environment is given, as the boot reads the real one.
    const moduleRef = await Test.createTestingModule({ imports: [LlmModule] })
      .overrideProvider(LLM_ENV)
      .useValue({ secret: undefined, adminGuildId: '713025650176294945' })
      .useMocker(() => ({}))
      .compile();

    const service = moduleRef.get(LlmService);
    expect(service).toBeInstanceOf(LlmService);
    expect(service.adminGuildId).toBe('713025650176294945');
    await moduleRef.close();
  });
});
