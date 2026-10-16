import { describe, expect, it } from 'vitest';
import { mentionMembers } from './chatbot-mentions.js';

const BLUE = { id: '690437429634793483', name: 'TestBlue🦆cần🏸' };
const ANH = { id: '100000000000000001', name: 'Anh' };
const ANH_TUAN = { id: '100000000000000002', name: 'Anh Tuấn' };
const members = [BLUE, ANH, ANH_TUAN];

describe('mentionMembers', () => {
  it('turns the plain @Name of the prod example into a mention', () => {
    expect(mentionMembers('Chào @TestBlue🦆cần🏸, khoẻ không?', members)).toBe(
      'Chào <@690437429634793483>, khoẻ không?',
    );
  });

  it('prefers the longest name', () => {
    expect(mentionMembers('@Anh Tuấn và @Anh', members)).toBe(
      '<@100000000000000002> và <@100000000000000001>',
    );
  });

  it('does not take the start of a longer word or an e-mail for a name', () => {
    expect(mentionMembers('@Anhh x@Anh', members)).toBe('@Anhh x@Anh');
  });

  it('is case-sensitive', () => {
    expect(mentionMembers('@anh', members)).toBe('@anh');
  });

  it('leaves a name two members share alone', () => {
    const twins = [ANH, { id: '100000000000000009', name: 'Anh' }];
    expect(mentionMembers('@Anh', twins)).toBe('@Anh');
  });

  it('never mentions the Deleted User placeholder', () => {
    const gone = [{ id: '100000000000000003', name: 'Deleted User' }];
    expect(mentionMembers('@Deleted User', gone)).toBe('@Deleted User');
  });

  it('keeps a mention of a known id', () => {
    expect(mentionMembers('<@100000000000000001> ơi', members)).toBe('<@100000000000000001> ơi');
  });

  it('turns a mention of an unknown id into plain text', () => {
    expect(mentionMembers('<@999999999999999999> và <@!888888888888888888>', members)).toBe(
      '@999999999999999999 và @888888888888888888',
    );
  });

  it('leaves code spans and fences as written', () => {
    const text = 'Dùng `@Anh` hoặc\n```\n@Anh <@999>\n```\nvà @Anh';
    expect(mentionMembers(text, members)).toBe(
      'Dùng `@Anh` hoặc\n```\n@Anh <@999>\n```\nvà <@100000000000000001>',
    );
  });

  it('leaves an unclosed fence as code to the end', () => {
    expect(mentionMembers('@Anh\n```\n@Anh', members)).toBe('<@100000000000000001>\n```\n@Anh');
  });

  it('handles an empty member list', () => {
    expect(mentionMembers('@Anh <@123>', [])).toBe('@Anh @123');
  });
});
