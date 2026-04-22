export interface RateLimiter {
  tryRemoveToken(): boolean;
}

export function createTokenBucketRateLimiter(input: {
  capacity: number;
  refillPerSecond: number;
  nowMs?: () => number;
}): RateLimiter {
  const nowMs = input.nowMs ?? (() => Date.now());
  const capacity = Math.max(1, Math.floor(input.capacity));
  const refillPerSecond = Math.max(0, input.refillPerSecond);

  let tokens = capacity;
  let lastRefillAt = nowMs();

  const refill = (): void => {
    const now = nowMs();
    const dt = Math.max(0, now - lastRefillAt);
    lastRefillAt = now;

    if (refillPerSecond <= 0) return;
    const add = (dt / 1000) * refillPerSecond;
    tokens = Math.min(capacity, tokens + add);
  };

  return {
    tryRemoveToken(): boolean {
      refill();
      if (tokens >= 1) {
        tokens -= 1;
        return true;
      }
      return false;
    },
  };
}
