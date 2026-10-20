import { describe, expect, it } from 'vitest';
import { fileNameFromDisposition } from './export-download';

describe('fileNameFromDisposition', () => {
  it('reads a plain and a quoted file name', () => {
    expect(fileNameFromDisposition('attachment; filename=members.xlsx')).toBe('members.xlsx');
    expect(fileNameFromDisposition('attachment; filename="members 1.xlsx"')).toBe('members 1.xlsx');
  });

  it('prefers the encoded name', () => {
    expect(
      fileNameFromDisposition(`attachment; filename="a.xlsx"; filename*=UTF-8''th%C3%A0nh.xlsx`),
    ).toBe('thành.xlsx');
  });

  it('never returns a path', () => {
    expect(fileNameFromDisposition('attachment; filename="../../etc/x.xlsx"')).toBe('x.xlsx');
  });

  it('gives nothing without a usable name', () => {
    expect(fileNameFromDisposition(null)).toBeUndefined();
    expect(fileNameFromDisposition('attachment')).toBeUndefined();
  });
});
