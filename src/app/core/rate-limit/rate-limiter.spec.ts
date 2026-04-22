import { createTokenBucketRateLimiter } from "./rate-limiter";

describe("createTokenBucketRateLimiter", () => {
  it("allows up to capacity and then rate limits", () => {
    const now = 0;
    const limiter = createTokenBucketRateLimiter({
      capacity: 2,
      refillPerSecond: 0,
      nowMs: () => now,
    });

    expect(limiter.tryRemoveToken()).toBe(true);
    expect(limiter.tryRemoveToken()).toBe(true);
    expect(limiter.tryRemoveToken()).toBe(false);
  });

  it("refills over time", () => {
    let now = 0;
    const limiter = createTokenBucketRateLimiter({
      capacity: 1,
      refillPerSecond: 1,
      nowMs: () => now,
    });

    expect(limiter.tryRemoveToken()).toBe(true);
    expect(limiter.tryRemoveToken()).toBe(false);

    now += 1100;
    expect(limiter.tryRemoveToken()).toBe(true);
  });
});
