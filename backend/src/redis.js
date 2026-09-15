// backend/src/redis.js
// Upstash Redis client with graceful fallback.
// Set REDIS_URL in your environment (e.g. rediss://default:xxx@xxx.upstash.io:6379)

import Redis from "ioredis";

let redis = null;
let redisOk = false;

if (process.env.REDIS_URL) {
  redis = new Redis(process.env.REDIS_URL, {
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    connectTimeout: 3000,
    lazyConnect: false,
    tls: process.env.REDIS_URL.startsWith("rediss://") ? {} : undefined,
  });

  redis.on("connect", () => {
    redisOk = true;
    console.log("✅ Redis connected (Upstash)");
  });

  redis.on("error", (err) => {
    redisOk = false;
    // Only log first error; suppress repeated noise
    if (err.code !== "ECONNREFUSED") console.warn("⚠️  Redis error:", err.message);
  });
} else {
  console.warn("⚠️  REDIS_URL not set – running without Redis cache (local dev mode)");
}

/**
 * Get a cached value by key. Returns null on miss or if Redis is down.
 */
export async function rGet(key) {
  if (!redis || !redisOk) return null;
  try {
    const val = await redis.get(key);
    return val ? JSON.parse(val) : null;
  } catch {
    return null;
  }
}

/**
 * Set a value with TTL (seconds). Silently fails if Redis is down.
 */
export async function rSet(key, value, ttlSeconds = 300) {
  if (!redis || !redisOk) return;
  try {
    await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  } catch { /* noop */ }
}

/**
 * Delete one or more keys. Used for cache invalidation.
 */
export async function rDel(...keys) {
  if (!redis || !redisOk || !keys.length) return;
  try {
    await redis.del(...keys);
  } catch { /* noop */ }
}

/**
 * Push a scan event into a Redis list for buffered DB writes.
 * Falls back to returning false if Redis is unavailable.
 */
export async function rPushScan(scan) {
  if (!redis || !redisOk) return false;
  try {
    const len = await redis.lpush("scan_buffer", JSON.stringify(scan));
    return len; // Returns the new length of the list
  } catch {
    return false;
  }
}

/**
 * Pop up to `count` scan events from the buffer.
 */
export async function rFlushScans(count = 100) {
  if (!redis || !redisOk) return [];
  try {
    // Upstash (Redis 6.2+) supports popping multiple elements in a single command
    const results = await redis.rpop("scan_buffer", count);
    if (!results) return [];
    
    // RPOP with count returns an array of strings
    return (Array.isArray(results) ? results : [results]).map(val => JSON.parse(val));
  } catch (err) {
    console.error("[scan-buffer] Redis pop error:", err.message);
    return [];
  }
}

export default redis;
