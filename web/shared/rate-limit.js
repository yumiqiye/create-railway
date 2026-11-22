/*
 * ══════════════════════════════════════════════════════
 *   清 江 铁 路  1 2 3 0 6    QINGJIANG RAILWAY
 *   版权所有，仿冒必究    All Rights Reserved
 * ══════════════════════════════════════════════════════
 */
/**
 * 令牌桶限流 + IP 黑名单
 * 每个 IP 维护一个令牌桶：容量 capacity，按 refillPerSecond 匀速补充。
 * 敏感接口使用更小的桶；连续超限达到阈值后自动封禁一段时间。
 */

class TokenBucket {
  constructor(capacity, refillPerSecond) {
    this.capacity = Math.max(1, Number(capacity) || 1);
    this.refillPerSecond = Math.max(0.001, Number(refillPerSecond) || 1);
    this.tokens = this.capacity;
    this.updatedAt = Date.now();
  }

  take(cost) {
    const now = Date.now();
    const elapsed = (now - this.updatedAt) / 1000;
    if (elapsed > 0) {
      this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.refillPerSecond);
      this.updatedAt = now;
    }
    const need = Math.max(1, Number(cost) || 1);
    if (this.tokens < need) return false;
    this.tokens -= need;
    return true;
  }

  retryAfter() {
    return Math.ceil((1 - this.tokens) / this.refillPerSecond);
  }
}

class RateLimiter {
  constructor() {
    this.buckets = new Map();
  }

  hit(key, policy, cost) {
    const capacity = policy.capacity;
    const refill = policy.refillPerSecond;
    let bucket = this.buckets.get(key);
    if (!bucket || bucket.capacity !== capacity || bucket.refillPerSecond !== refill) {
      bucket = new TokenBucket(capacity, refill);
      this.buckets.set(key, bucket);
    }
    const allowed = bucket.take(cost);
    return { allowed, retryAfter: allowed ? 0 : bucket.retryAfter() };
  }

  cleanup(maxAgeMs) {
    const now = Date.now();
    for (const [key, bucket] of this.buckets) {
      if (now - bucket.updatedAt > maxAgeMs) this.buckets.delete(key);
    }
  }
}

module.exports = { TokenBucket, RateLimiter };
