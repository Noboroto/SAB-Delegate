import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  BirthdayAddSchema,
  BirthdayAddResultSchema,
  BirthdayEntryViewSchema,
  BirthdayImportReportSchema,
  BirthdayImportRequestSchema,
  BirthdayListQuerySchema,
  BirthdayRemoveResultSchema,
  BirthdaySelectorSchema,
  ErrorCode,
  destructiveQueryShape,
  z,
  type BirthdayAdd,
  type BirthdayAddResult,
  type BirthdayEntryView,
  type BirthdayImportProblem,
  type BirthdayImportReport,
  type BirthdayRemoveResult,
} from '@sab/shared';
import { Principal, type SessionPrincipal } from '../../auth/principal.decorator.js';
import { ApiError } from '../../common/errors/http-error.js';
import { ManageGuildGuard } from '../../common/guild-access/manage-guild.guard.js';
import { requireConfirmation } from '../../common/rest/rest-support.js';
import { httpActor } from '../../common/rest/rest-wiring.js';
import { BIRTHDAY_CSV_MAX_BYTES, parseBirthdayCsv } from './birthday.csv.js';
import { BirthdayService } from './birthday.service.js';

const RemoveQuerySchema = requireConfirmation(BirthdaySelectorSchema.extend(destructiveQueryShape));

type ImportRequest = z.output<typeof BirthdayImportRequestSchema>;

/** Rows to merge and the CSV lines that could not become rows. */
function rowsOf(request: ImportRequest): {
  rows: BirthdayAdd[];
  problems: BirthdayImportProblem[];
} {
  if (request.rows !== undefined) return { rows: request.rows, problems: [] };
  const csv = request.csv ?? '';
  if (Buffer.byteLength(csv) > BIRTHDAY_CSV_MAX_BYTES) {
    throw new ApiError(ErrorCode.VALIDATION_FAILED, undefined, { reason: 'CSV_TOO_LARGE' });
  }
  const parsed = parseBirthdayCsv(csv);
  if (!parsed.ok) {
    throw new ApiError(ErrorCode.VALIDATION_FAILED, undefined, { reason: parsed.reason });
  }
  return { rows: parsed.rows.map(({ entry }) => entry), problems: parsed.problems };
}

@Controller('api/guilds/:guildId/birthdays')
@UseGuards(ManageGuildGuard)
export class BirthdayController {
  constructor(private readonly birthdays: BirthdayService) {}

  @Get()
  async list(
    @Param('guildId') guildId: string,
    @Query({ schema: BirthdayListQuerySchema }) query: z.output<typeof BirthdayListQuerySchema>,
  ): Promise<BirthdayEntryView[]> {
    const entries = await this.birthdays.list(
      guildId,
      query.month === undefined ? {} : { month: query.month },
    );
    return z.array(BirthdayEntryViewSchema).parse(entries);
  }

  @Post()
  async add(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: BirthdayAddSchema }) body: BirthdayAdd,
  ): Promise<BirthdayAddResult> {
    return BirthdayAddResultSchema.parse(
      await this.birthdays.add(guildId, body, httpActor(principal)),
    );
  }

  /** Removes by student ID or by Discord user; `dryRun` previews, `confirm=true` runs. */
  @Delete()
  async remove(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Query({ schema: RemoveQuerySchema }) query: z.output<typeof RemoveQuerySchema>,
  ): Promise<BirthdayRemoveResult> {
    const { studentId, discordId, dryRun } = query;
    return BirthdayRemoveResultSchema.parse(
      await this.birthdays.remove(guildId, { studentId, discordId }, httpActor(principal), {
        dryRun,
      }),
    );
  }

  /** Only merges: a student ID the list already holds is skipped and named in `duplicates`. */
  @Post('import')
  @HttpCode(200)
  async importRows(
    @Param('guildId') guildId: string,
    @Principal() principal: SessionPrincipal,
    @Body({ schema: BirthdayImportRequestSchema }) body: ImportRequest,
  ): Promise<BirthdayImportReport> {
    const { rows, problems } = rowsOf(body);
    const result = await this.birthdays.importRows(guildId, rows, httpActor(principal), {
      dryRun: body.dryRun,
    });
    return BirthdayImportReportSchema.parse({ ...result, problems });
  }
}
