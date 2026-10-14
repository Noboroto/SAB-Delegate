import { BIRTHDAY_CSV_TEMPLATE } from '@sab/shared';

/** Hands the person the template the server expects, built here so no request is needed. */
export function downloadBirthdayTemplate(fileName: string): void {
  const url = URL.createObjectURL(
    new Blob([BIRTHDAY_CSV_TEMPLATE], { type: 'text/csv;charset=utf-8' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

/** Mirrors the server's CSV size limit so a huge file is refused before it is read; the server stays the authority. */
export const BIRTHDAY_CSV_MAX_BYTES = 1024 * 1024;
