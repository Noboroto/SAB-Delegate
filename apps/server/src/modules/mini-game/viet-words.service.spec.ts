import { describe, expect, it, vi } from 'vitest';
import type { AppStateService } from '../../app-state/app-state.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import { normalizeWord, VietWordsService } from './viet-words.service.js';

describe('normalizeWord', () => {
  it('drops every mark, spaces and case, and reads đ as d', () => {
    expect(normalizeWord('Hậu Cần')).toBe('haucan');
    expect(normalizeWord('hầu cận')).toBe('haucan');
    expect(normalizeWord('  Đường   đi ')).toBe('duongdi');
    expect(normalizeWord('học sinh'.normalize('NFD'))).toBe('hocsinh');
  });
});

function build(rows: string[]) {
  const findMany = vi.fn(() => Promise.resolve(rows.map((word) => ({ word }))));
  const prisma = { vietWord: { findMany } } as unknown as PrismaService;
  const service = new VietWordsService(prisma, {} as AppStateService);
  vi.spyOn(service as unknown as { seed: () => Promise<void> }, 'seed').mockResolvedValue();
  return { service, findMany };
}

describe('VietWordsService.isVietnameseWord', () => {
  it('looks up by the normalized key, then checks the exact letters and tones', async () => {
    const { service, findMany } = build(['hầu cận', 'hậu cần']);
    await expect(service.isVietnameseWord('HẬU CẦN')).resolves.toBe(true);
    await expect(service.isVietnameseWord('hầucận')).resolves.toBe(true);
    expect(findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { normalized: 'haucan' } }),
    );
  });

  it('refuses a word that shares the key but not the tones', async () => {
    const { service } = build(['hầu cận', 'hậu cần']);
    await expect(service.isVietnameseWord('hau can')).resolves.toBe(false);
    await expect(service.isVietnameseWord('hấu cạn')).resolves.toBe(false);
  });

  it('answers no for text with no letters, without a query', async () => {
    const { service, findMany } = build([]);
    await expect(service.isVietnameseWord('   ')).resolves.toBe(false);
    expect(findMany).not.toHaveBeenCalled();
  });
});
