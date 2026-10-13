/** Snowflakes order by creation time, but only as numbers: as strings "9" sorts after "10". */
export const compareSnowflakes = (a: string, b: string): number => {
  const left = BigInt(a);
  const right = BigInt(b);
  if (left === right) return 0;
  return left < right ? -1 : 1;
};

/** Whether `a` was created strictly after `b`. */
export const isNewer = (a: string, b: string): boolean => compareSnowflakes(a, b) > 0;
