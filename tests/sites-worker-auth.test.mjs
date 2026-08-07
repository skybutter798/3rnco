import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const cryptoSource = await readFile(new URL("../worker/crypto.ts", import.meta.url), "utf8");
const authSource = await readFile(new URL("../worker/auth.ts", import.meta.url), "utf8");
const httpSource = await readFile(new URL("../worker/http.ts", import.meta.url), "utf8");
const apiSource = await readFile(new URL("../worker/api.ts", import.meta.url), "utf8");
const rateLimitSource = await readFile(new URL("../worker/rate-limit.ts", import.meta.url), "utf8");

test("password and session implementation uses server-side cryptography", () => {
  assert.match(cryptoSource, /const PBKDF2_ITERATIONS = 600_000/u);
  assert.match(cryptoSource, /crypto\.subtle\.deriveBits/u);
  assert.match(cryptoSource, /crypto\.getRandomValues/u);
  assert.match(cryptoSource, /pbkdf2-sha256\$/u);
  assert.match(authSource, /await hashPassword\("88888888"\)|hashPassword\(password\)/u);
  assert.match(authSource, /__Host-3rnco_session/u);
  assert.match(authSource, /HttpOnly; Secure; SameSite=Lax/u);
  assert.match(authSource, /x-csrf-token/u);
  assert.match(authSource, /must_change_password = 0/u);
  assert.match(authSource, /UPDATE user_sessions SET revoked_at/u);
  assert.match(authSource, /BOOTSTRAP_ADMIN_NETWORK_REQUIRED/u);
  assert.match(rateLimitSource, /ON CONFLICT\(key_hash\) DO UPDATE SET/u);
  assert.match(rateLimitSource, /attempts \+ 1/u);
});

test("API helpers implement the fixed success and error envelopes", () => {
  assert.match(httpSource, /JSON\.stringify\(\{ ok: true, data \}\)/u);
  assert.match(httpSource, /ok: false/u);
  assert.match(httpSource, /error: \{ code, message/u);
  assert.match(httpSource, /"cache-control": "no-store"/u);
  assert.match(httpSource, /"x-content-type-options": "nosniff"/u);
  assert.match(apiSource, /return await dispatchApi\(request, env\)/u);
  assert.match(apiSource, /data: \{ status: "ok" \}/u);
});
