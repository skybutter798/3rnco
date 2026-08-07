import { sha256 } from "./crypto";
import { ApiError } from "./http";

type RateLimitOptions = {
  bucket: string;
  limit: number;
  windowSeconds: number;
  discriminator?: string;
  code?: string;
  message?: string;
};

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip")
    ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
    ?? "local";
}

export async function consumeRateLimit(
  db: D1Database,
  request: Request,
  options: RateLimitOptions,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  const cutoff = now - options.windowSeconds;
  const identity = `${clientAddress(request)}:${options.discriminator ?? ""}`;
  const keyHash = await sha256(`rate:${options.bucket}:${identity}`);
  const row = await db.prepare(`INSERT INTO auth_rate_limits
      (key_hash, window_started_at, attempts, blocked_until, updated_at)
    VALUES (?, ?, 1, NULL, ?)
    ON CONFLICT(key_hash) DO UPDATE SET
      attempts = CASE WHEN window_started_at <= ? THEN 1 ELSE attempts + 1 END,
      blocked_until = CASE
        WHEN blocked_until IS NOT NULL AND blocked_until > ? THEN blocked_until
        WHEN window_started_at <= ? THEN NULL
        WHEN attempts + 1 > ? THEN ?
        ELSE NULL
      END,
      window_started_at = CASE WHEN window_started_at <= ? THEN ? ELSE window_started_at END,
      updated_at = ?
    RETURNING attempts, blocked_until AS blockedUntil`)
    .bind(
      keyHash, now, now,
      cutoff, now, cutoff, options.limit, now + options.windowSeconds,
      cutoff, now, now,
    ).first<{ attempts: number; blockedUntil: number | null }>();
  if (Number(row?.blockedUntil ?? 0) > now) {
    throw new ApiError(
      429,
      options.code ?? "RATE_LIMITED",
      options.message ?? "Too many requests. Please wait and try again.",
    );
  }
  return keyHash;
}

export async function clearRateLimits(db: D1Database, keyHashes: string[]): Promise<void> {
  if (!keyHashes.length) return;
  await db.batch(keyHashes.map((keyHash) => db.prepare(
    "DELETE FROM auth_rate_limits WHERE key_hash = ?",
  ).bind(keyHash)));
}
