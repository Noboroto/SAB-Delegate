import { ChatInputCommandInteraction } from "discord.js";

// The schedule commands document their input as UTC+7, regardless of the host timezone.
const UTC_OFFSET_HOURS = 7;
const HOUR_MS = 60 * 60 * 1000;

const formatVn = (date: Date) =>
  date.toLocaleString("vi-VN", {
    timeZone: "Asia/Ho_Chi_Minh",
    day: "2-digit",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });

export type ScheduleTime = {
  /** null when day/month do not form a real calendar date (e.g. 31/02). */
  date: Date | null;
  dateStr: string;
  nowStr: string;
};

/** Reads hour/minute/second/day/month/year options as a UTC+7 wall-clock time. */
export const readScheduleTime = (
  interaction: ChatInputCommandInteraction
): ScheduleTime => {
  const now = new Date();
  const vnNow = new Date(now.getTime() + UTC_OFFSET_HOURS * HOUR_MS);

  const day = interaction.options.getInteger("day") ?? vnNow.getUTCDate();
  const month =
    interaction.options.getInteger("month") ?? vnNow.getUTCMonth() + 1;
  const year = interaction.options.getInteger("year") ?? vnNow.getUTCFullYear();
  const hour = interaction.options.getInteger("hour");
  const minute = interaction.options.getInteger("minute");
  const second = interaction.options.getInteger("second") ?? 0;

  const date = new Date(
    Date.UTC(year, month - 1, day, hour - UTC_OFFSET_HOURS, minute, second)
  );
  // Date.UTC rolls 31/02 over to 03/03; reading it back catches that.
  const vnDate = new Date(date.getTime() + UTC_OFFSET_HOURS * HOUR_MS);
  const isRealDate =
    vnDate.getUTCFullYear() === year &&
    vnDate.getUTCMonth() === month - 1 &&
    vnDate.getUTCDate() === day;

  return {
    date: isRealDate ? date : null,
    dateStr: isRealDate
      ? formatVn(date)
      : `${day}/${month}/${year} ${hour}:${minute}`,
    nowStr: formatVn(now),
  };
};
