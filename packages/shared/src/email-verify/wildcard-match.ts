/**
 * Whether `value` matches `pattern` end to end, where `*` stands for any run of
 * characters (also none) and every other character stands for itself. Both are
 * expected lower-case already. Linear backtracking over the last `*` instead of
 * a regular expression, so a pattern with many stars cannot take exponential time.
 */
export function wildcardMatch(pattern: string, value: string): boolean {
  let p = 0;
  let v = 0;
  let star = -1;
  let resume = 0;
  while (v < value.length) {
    if (p < pattern.length && pattern[p] === '*') {
      star = p;
      resume = v;
      p += 1;
    } else if (p < pattern.length && pattern[p] === value[v]) {
      p += 1;
      v += 1;
    } else if (star !== -1) {
      p = star + 1;
      resume += 1;
      v = resume;
    } else {
      return false;
    }
  }
  while (p < pattern.length && pattern[p] === '*') p += 1;
  return p === pattern.length;
}
