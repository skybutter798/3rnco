import {
  hashPassword,
  isAcceptableCustomerPassword,
  isStrongAdminPassword,
  normalizeEmail,
  normalizePhone,
  normalizeUsername,
  parseCookies,
  randomId,
  randomToken,
  sha256,
  verifyPassword,
} from "./crypto";
import {
  ApiError,
  assertSameOrigin,
  ok,
  readJson,
  requiredString,
} from "./http";
import { clearRateLimits, consumeRateLimit } from "./rate-limit";

const SESSION_COOKIE = "__Host-3rnco_session";
const CSRF_COOKIE = "3rnco_csrf";
const CUSTOMER_ABSOLUTE_SECONDS = 30 * 24 * 60 * 60;
const CUSTOMER_IDLE_SECONDS = 24 * 60 * 60;
const ADMIN_ABSOLUTE_SECONDS = 12 * 60 * 60;
const ADMIN_IDLE_SECONDS = 30 * 60;
const DUMMY_PASSWORD_HASH =
  "pbkdf2-sha256$600000$Ok99CJ-BqedFBoBbyHqbTg$Whmq8EHFjvl8T1ycwwEDKkNeANMdGxday15e2k5e_wg";

type UserRole = "ADMIN" | "STAFF" | "CUSTOMER";

type SessionRow = {
  sessionId: string;
  userId: string;
  username: string | null;
  email: string | null;
  role: UserRole;
  status: string;
  mustChangePassword: number;
  fullName: string | null;
  phoneE164: string | null;
  csrfTokenHash: string;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  revokedAt: number | null;
  permissionsJson: string | null;
};

export type AuthenticatedSession = {
  sessionId: string;
  csrfTokenHash: string;
  idleExpiresAt: number;
  absoluteExpiresAt: number;
  user: {
    id: string;
    username: string | null;
    email: string | null;
    role: UserRole;
    fullName: string;
    phone: string | null;
    mustChangePassword: boolean;
    permissions: string[];
  };
};

type CreatedSession = {
  token: string;
  csrfToken: string;
  maxAge: number;
};

function nowSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function assertBootstrapAdminNetwork(
  request: Request,
  bootstrapAdminIps: string | undefined,
  user: { role: UserRole; mustChangePassword: boolean | number },
): void {
  if (
    user.role !== "ADMIN" ||
    user.mustChangePassword === false ||
    user.mustChangePassword === 0
  )
    return;
  const hostname = new URL(request.url).hostname;
  const local =
    hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  const remoteAddress =
    request.headers.get("cf-connecting-ip") ?? (local ? "127.0.0.1" : "");
  const allowed = (bootstrapAdminIps ?? "")
    .split(/[\s,]+/u)
    .map((value) => value.trim())
    .filter(Boolean);
  if (local) allowed.push("127.0.0.1", "::1");
  if (!remoteAddress || !allowed.includes(remoteAddress)) {
    throw new ApiError(
      403,
      "BOOTSTRAP_ADMIN_NETWORK_REQUIRED",
      "The temporary administrator password may only be used from the configured bootstrap network.",
    );
  }
}

function sessionUser(session: AuthenticatedSession) {
  return {
    id: session.user.id,
    username: session.user.username,
    email: session.user.email,
    role: session.user.role.toLowerCase(),
    fullName: session.user.fullName,
    phone: session.user.phone,
    mustChangePassword: session.user.mustChangePassword,
    permissions: session.user.permissions,
  };
}

function appendSessionCookies(
  response: Response,
  created: CreatedSession,
): Response {
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(created.token)}; Path=/; Max-Age=${created.maxAge}; HttpOnly; Secure; SameSite=Lax`,
  );
  response.headers.append(
    "set-cookie",
    `${CSRF_COOKIE}=${encodeURIComponent(created.csrfToken)}; Path=/; Max-Age=${created.maxAge}; Secure; SameSite=Strict`,
  );
  return response;
}

function appendClearedCookies(response: Response): Response {
  response.headers.append(
    "set-cookie",
    `${SESSION_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`,
  );
  response.headers.append(
    "set-cookie",
    `${CSRF_COOKIE}=; Path=/; Max-Age=0; Secure; SameSite=Strict`,
  );
  return response;
}

async function createSession(
  db: D1Database,
  userId: string,
  role: UserRole,
  request: Request,
): Promise<CreatedSession> {
  const now = nowSeconds();
  const absoluteSeconds =
    role !== "CUSTOMER" ? ADMIN_ABSOLUTE_SECONDS : CUSTOMER_ABSOLUTE_SECONDS;
  const idleSeconds =
    role !== "CUSTOMER" ? ADMIN_IDLE_SECONDS : CUSTOMER_IDLE_SECONDS;
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const userAgent = request.headers.get("user-agent") ?? "";
  const ipPrefix =
    request.headers.get("cf-connecting-ip")?.split(".").slice(0, 3).join(".") ??
    "";
  await db
    .prepare(
      `INSERT INTO user_sessions
    (id, user_id, token_hash, csrf_token_hash, user_agent_hash, ip_prefix_hash,
     last_seen_at, idle_expires_at, absolute_expires_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      randomId("session"),
      userId,
      await sha256(token),
      await sha256(csrfToken),
      userAgent ? await sha256(userAgent) : null,
      ipPrefix ? await sha256(ipPrefix) : null,
      now,
      now + idleSeconds,
      now + absoluteSeconds,
    )
    .run();
  return { token, csrfToken, maxAge: absoluteSeconds };
}

export async function getSession(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedSession | null> {
  const token = parseCookies(request.headers.get("cookie"))[SESSION_COOKIE];
  if (!token) return null;
  const tokenHash = await sha256(token);
  const row = await db
    .prepare(
      `SELECT
      s.id AS sessionId, s.csrf_token_hash AS csrfTokenHash,
      s.idle_expires_at AS idleExpiresAt, s.absolute_expires_at AS absoluteExpiresAt,
      s.revoked_at AS revokedAt,
      u.id AS userId, u.username, u.email, CASE WHEN sp.user_id IS NOT NULL THEN 'STAFF' ELSE u.role END AS role, u.status,
      u.must_change_password AS mustChangePassword,
      p.full_name AS fullName, p.phone_e164 AS phoneE164, sp.permissions_json AS permissionsJson
    FROM user_sessions s
    JOIN users u ON u.id = s.user_id
    LEFT JOIN customer_profiles p ON p.user_id = u.id
    LEFT JOIN staff_profiles sp ON sp.user_id = u.id
    WHERE s.token_hash = ?
    LIMIT 1`,
    )
    .bind(tokenHash)
    .first<SessionRow>();
  if (!row) return null;
  const now = nowSeconds();
  if (
    row.revokedAt ||
    row.status !== "ACTIVE" ||
    row.idleExpiresAt <= now ||
    row.absoluteExpiresAt <= now
  ) {
    await db
      .prepare(
        "UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE id = ?",
      )
      .bind(now, row.sessionId)
      .run();
    return null;
  }

  const idleSeconds =
    row.role !== "CUSTOMER" ? ADMIN_IDLE_SECONDS : CUSTOMER_IDLE_SECONDS;
  const nextIdleExpiry = Math.min(row.absoluteExpiresAt, now + idleSeconds);
  if (nextIdleExpiry - row.idleExpiresAt > 60) {
    await db
      .prepare(
        "UPDATE user_sessions SET last_seen_at = ?, idle_expires_at = ? WHERE id = ?",
      )
      .bind(now, nextIdleExpiry, row.sessionId)
      .run();
  }
  return {
    sessionId: row.sessionId,
    csrfTokenHash: row.csrfTokenHash,
    idleExpiresAt: nextIdleExpiry,
    absoluteExpiresAt: row.absoluteExpiresAt,
    user: {
      id: row.userId,
      username: row.username,
      email: row.email,
      role: row.role,
      fullName: row.fullName ?? row.username ?? row.email ?? "Customer",
      phone: row.phoneE164,
      mustChangePassword: Boolean(row.mustChangePassword),
      permissions: row.permissionsJson ? JSON.parse(row.permissionsJson) as string[] : [],
    },
  };
}

export async function requireSession(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedSession> {
  const session = await getSession(request, db);
  if (!session)
    throw new ApiError(401, "AUTH_REQUIRED", "Please sign in to continue.");
  return session;
}

export async function requireCustomer(
  request: Request,
  db: D1Database,
): Promise<AuthenticatedSession> {
  const session = await requireSession(request, db);
  if (session.user.role !== "CUSTOMER")
    throw new ApiError(
      403,
      "CUSTOMER_REQUIRED",
      "A customer account is required.",
    );
  return session;
}

export async function requireAdmin(
  request: Request,
  db: D1Database,
  options: { allowMustChange?: boolean; mutation?: boolean; permission?: string } = {},
): Promise<AuthenticatedSession> {
  const session = await requireSession(request, db);
  if (!new Set<UserRole>(["ADMIN", "STAFF"]).has(session.user.role))
    throw new ApiError(403, "ADMIN_REQUIRED", "Admin access is required.");
  if (!options.allowMustChange && session.user.mustChangePassword) {
    throw new ApiError(
      403,
      "PASSWORD_CHANGE_REQUIRED",
      "Change the default password before making admin changes.",
    );
  }
  if (session.user.role === "STAFF" && options.permission && !session.user.permissions.includes(options.permission)) {
    throw new ApiError(403, "STAFF_PERMISSION_REQUIRED", "Your staff account does not have access to this area.");
  }
  if (options.mutation) await verifyCsrf(request, session);
  return session;
}

export async function requireOwner(
  request: Request,
  db: D1Database,
  options: { allowMustChange?: boolean; mutation?: boolean; permission?: string } = {},
): Promise<AuthenticatedSession> {
  const session = await requireAdmin(request, db, options);
  if (session.user.role !== "ADMIN")
    throw new ApiError(403, "OWNER_REQUIRED", "Store owner access is required.");
  return session;
}

export async function verifyCsrf(
  request: Request,
  session: AuthenticatedSession,
): Promise<void> {
  assertSameOrigin(request);
  const headerToken = request.headers.get("x-csrf-token") ?? "";
  const cookieToken =
    parseCookies(request.headers.get("cookie"))[CSRF_COOKIE] ?? "";
  if (
    !headerToken ||
    !cookieToken ||
    headerToken !== cookieToken ||
    (await sha256(headerToken)) !== session.csrfTokenHash
  ) {
    throw new ApiError(403, "CSRF_REJECTED", "Refresh the page and try again.");
  }
}

export async function handleRegister(
  request: Request,
  db: D1Database,
): Promise<Response> {
  assertSameOrigin(request);
  await consumeRateLimit(db, request, {
    bucket: "register",
    limit: 5,
    windowSeconds: 60 * 60,
    code: "REGISTER_RATE_LIMITED",
    message: "Too many registration attempts. Please try again later.",
  });
  const body = await readJson<Record<string, unknown>>(request);
  const fullName = requiredString(body.fullName, "fullName", {
    min: 2,
    max: 120,
  });
  const email = normalizeEmail(
    requiredString(body.email, "email", { min: 5, max: 254 }),
  );
  const phone = normalizePhone(
    requiredString(body.phone, "phone", { min: 7, max: 30 }),
  );
  const password = requiredString(body.password, "password", {
    min: 8,
    max: 128,
  });
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Please enter a valid email address.",
      { email: "Enter a valid email address." },
    );
  }
  if (phone.replace(/\D/gu, "").length < 8) {
    throw new ApiError(
      422,
      "VALIDATION_ERROR",
      "Please enter a valid mobile number.",
      { phone: "Enter a valid mobile number." },
    );
  }
  if (!isAcceptableCustomerPassword(password)) {
    throw new ApiError(422, "WEAK_PASSWORD", "Use at least 8 characters.", {
      password: "Use at least 8 characters.",
    });
  }
  const exists = await db
    .prepare("SELECT 1 AS found FROM users WHERE email_normalized = ? LIMIT 1")
    .bind(email)
    .first<{ found: number }>();
  if (exists)
    throw new ApiError(
      409,
      "EMAIL_IN_USE",
      "An account already uses this email address.",
    );

  const userId = randomId("user");
  const passwordHash = await hashPassword(password);
  await db.batch([
    db
      .prepare(
        `INSERT INTO users
      (id, email, email_normalized, password_hash, role, status, must_change_password)
      VALUES (?, ?, ?, ?, 'CUSTOMER', 'ACTIVE', 0)`,
      )
      .bind(userId, email, email, passwordHash),
    db
      .prepare(
        `INSERT INTO customer_profiles
      (user_id, full_name, phone_e164)
      VALUES (?, ?, ?)`,
      )
      .bind(userId, fullName, phone),
  ]);
  const created = await createSession(db, userId, "CUSTOMER", request);
  const response = ok(
    {
      user: {
        id: userId,
        username: null,
        email,
        role: "customer",
        fullName,
        phone,
        mustChangePassword: false,
      },
      csrfToken: created.csrfToken,
    },
    201,
  );
  return appendSessionCookies(response, created);
}

export async function handleLogin(
  request: Request,
  db: D1Database,
  adminOnly = false,
  bootstrapAdminIps?: string,
): Promise<Response> {
  assertSameOrigin(request);
  const body = await readJson<Record<string, unknown>>(request);
  const identifier = requiredString(
    body.identifier ?? body.email,
    "identifier",
    { min: 1, max: 254 },
  );
  const password = requiredString(body.password, "password", {
    min: 1,
    max: 128,
  });
  const normalized = identifier.includes("@")
    ? normalizeEmail(identifier)
    : normalizeUsername(identifier);
  const rateKeys = [
    await consumeRateLimit(db, request, {
      bucket: "login-ip",
      limit: 20,
      windowSeconds: 15 * 60,
      code: "LOGIN_RATE_LIMITED",
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    }),
    await consumeRateLimit(db, request, {
      bucket: "login-identifier",
      discriminator: normalized,
      limit: 5,
      windowSeconds: 15 * 60,
      code: "LOGIN_RATE_LIMITED",
      message: "Too many sign-in attempts. Try again in 15 minutes.",
    }),
  ];
  const user = await db
    .prepare(
      `SELECT
      u.id, u.username, u.email, u.password_hash AS passwordHash,
      CASE WHEN sp.user_id IS NOT NULL THEN 'STAFF' ELSE u.role END AS role, u.status,
      u.must_change_password AS mustChangePassword, u.failed_login_count AS failedLoginCount,
      u.locked_until AS lockedUntil, p.full_name AS fullName, p.phone_e164 AS phoneE164,
      sp.permissions_json AS permissionsJson
    FROM users u
    LEFT JOIN customer_profiles p ON p.user_id = u.id
    LEFT JOIN staff_profiles sp ON sp.user_id = u.id
    WHERE u.email_normalized = ? OR u.username_normalized = ?
    LIMIT 1`,
    )
    .bind(normalized, normalized)
    .first<{
      id: string;
      username: string | null;
      email: string | null;
      passwordHash: string;
      role: UserRole;
      status: string;
      mustChangePassword: number;
      failedLoginCount: number;
      lockedUntil: number | null;
      fullName: string | null;
      phoneE164: string | null;
      permissionsJson: string | null;
    }>();

  const now = nowSeconds();
  if (user?.lockedUntil && user.lockedUntil > now) {
    throw new ApiError(
      429,
      "ACCOUNT_LOCKED",
      "Too many sign-in attempts. Try again later.",
    );
  }
  const passwordMatches = user
    ? await verifyPassword(password, user.passwordHash)
    : await verifyPassword(password, DUMMY_PASSWORD_HASH);
  if (
    !user ||
    !passwordMatches ||
    user.status !== "ACTIVE" ||
    (adminOnly && !["ADMIN", "STAFF"].includes(user.role))
  ) {
    if (user)
      await db
        .prepare(
          `UPDATE users SET
      failed_login_count = failed_login_count + 1,
      locked_until = CASE WHEN failed_login_count + 1 >= 5 THEN ? ELSE locked_until END,
      updated_at = unixepoch() WHERE id = ?`,
        )
        .bind(now + 15 * 60, user.id)
        .run();
    throw new ApiError(
      401,
      "INVALID_CREDENTIALS",
      "The email or password is incorrect.",
    );
  }
  assertBootstrapAdminNetwork(request, bootstrapAdminIps, user);

  await db.batch([
    db
      .prepare(
        "UPDATE users SET failed_login_count = 0, locked_until = NULL, last_login_at = ?, updated_at = ? WHERE id = ?",
      )
      .bind(now, now, user.id),
  ]);
  await clearRateLimits(db, rateKeys);
  const created = await createSession(db, user.id, user.role, request);
  const session: AuthenticatedSession = {
    sessionId: "new",
    csrfTokenHash: await sha256(created.csrfToken),
    idleExpiresAt: now,
    absoluteExpiresAt: now + created.maxAge,
    user: {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      fullName: user.fullName ?? user.username ?? user.email ?? "Customer",
      phone: user.phoneE164,
      mustChangePassword: Boolean(user.mustChangePassword),
      permissions: user.permissionsJson ? JSON.parse(user.permissionsJson) as string[] : [],
    },
  };
  return appendSessionCookies(
    ok({ user: sessionUser(session), csrfToken: created.csrfToken }),
    created,
  );
}

export async function handleSession(
  request: Request,
  db: D1Database,
  adminOnly = false,
): Promise<Response> {
  const session = await getSession(request, db);
  if (!session || (adminOnly && !["ADMIN", "STAFF"].includes(session.user.role))) {
    return appendClearedCookies(
      ok({ authenticated: false, user: null, csrfToken: null }),
    );
  }
  let csrfToken =
    parseCookies(request.headers.get("cookie"))[CSRF_COOKIE] ?? "";
  let response: Response;
  if (!csrfToken || (await sha256(csrfToken)) !== session.csrfTokenHash) {
    csrfToken = randomToken(24);
    await db
      .prepare("UPDATE user_sessions SET csrf_token_hash = ? WHERE id = ?")
      .bind(await sha256(csrfToken), session.sessionId)
      .run();
    response = ok({
      authenticated: true,
      user: sessionUser(session),
      csrfToken,
    });
    response.headers.append(
      "set-cookie",
      `${CSRF_COOKIE}=${encodeURIComponent(csrfToken)}; Path=/; Max-Age=${Math.max(1, session.absoluteExpiresAt - nowSeconds())}; Secure; SameSite=Strict`,
    );
    return response;
  }
  return ok({ authenticated: true, user: sessionUser(session), csrfToken });
}

export async function handleLogout(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const session = await getSession(request, db);
  if (session) {
    await verifyCsrf(request, session);
    await db
      .prepare("UPDATE user_sessions SET revoked_at = unixepoch() WHERE id = ?")
      .bind(session.sessionId)
      .run();
  }
  return appendClearedCookies(ok({ signedOut: true }));
}

export async function handleChangePassword(
  request: Request,
  db: D1Database,
  bootstrapAdminIps?: string,
): Promise<Response> {
  const session = await requireSession(request, db);
  await verifyCsrf(request, session);
  assertBootstrapAdminNetwork(request, bootstrapAdminIps, session.user);
  const body = await readJson<Record<string, unknown>>(request);
  const currentPassword = requiredString(
    body.currentPassword,
    "currentPassword",
    { min: 1, max: 128 },
  );
  const adminPassword = session.user.role === "ADMIN";
  const newPassword = requiredString(body.newPassword, "newPassword", {
    min: adminPassword ? 12 : 8,
    max: 128,
  });
  if (
    adminPassword
      ? !isStrongAdminPassword(newPassword)
      : !isAcceptableCustomerPassword(newPassword)
  ) {
    const guidance = adminPassword
      ? "Use at least 12 characters with a letter and number."
      : "Use at least 8 characters.";
    throw new ApiError(422, "WEAK_PASSWORD", guidance, {
      newPassword: guidance,
    });
  }
  if (currentPassword === newPassword) {
    throw new ApiError(
      422,
      "PASSWORD_UNCHANGED",
      "Choose a password different from the current password.",
    );
  }
  const user = await db
    .prepare("SELECT password_hash AS passwordHash FROM users WHERE id = ?")
    .bind(session.user.id)
    .first<{ passwordHash: string }>();
  if (!user || !(await verifyPassword(currentPassword, user.passwordHash))) {
    throw new ApiError(
      401,
      "INVALID_CURRENT_PASSWORD",
      "The current password is incorrect.",
    );
  }
  const nextHash = await hashPassword(newPassword);
  const now = nowSeconds();
  await db.batch([
    db
      .prepare(
        `UPDATE users SET password_hash = ?, must_change_password = 0,
      password_changed_at = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(nextHash, now, now, session.user.id),
    db
      .prepare(
        "UPDATE user_sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL",
      )
      .bind(now, session.user.id),
  ]);
  const created = await createSession(
    db,
    session.user.id,
    session.user.role,
    request,
  );
  return appendSessionCookies(
    ok({
      changed: true,
      user: { ...sessionUser(session), mustChangePassword: false },
      csrfToken: created.csrfToken,
    }),
    created,
  );
}
