import { getSession, requireAdmin, requireCustomer } from "./auth";
import { randomId, sha256 } from "./crypto";
import { allRows } from "./database";
import {
  ApiError,
  assertSameOrigin,
  booleanField,
  integerField,
  ok,
  optionalString,
  readJson,
  requiredString,
} from "./http";
import { consumeRateLimit } from "./rate-limit";

export type ReferralLinkRow = {
  id: string;
  code: string;
  name: string;
  referrerUserId: string;
  referrerName: string;
  referrerEmail: string;
  discountBasisPoints: number;
  discountScope: "NONE" | "FIRST_PURCHASE" | "EVERY_PURCHASE";
  commissionBasisPoints: number;
  attributionDays: number;
  startsAt: number | null;
  endsAt: number | null;
  status: string;
};

export type OrderReferral = {
  link: ReferralLinkRow | null;
  discountMinor: number;
  assignment: D1PreparedStatement | null;
};

export function normalizeReferralCode(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value !== "string") throw new ApiError(422, "REFERRAL_INVALID", "That referral link is not valid.");
  const code = value.trim().toLowerCase();
  if (!/^[a-z0-9_-]{2,50}$/u.test(code)) throw new ApiError(422, "REFERRAL_INVALID", "That referral link is not valid.");
  return code;
}

async function activeLink(db: D1Database, code: string): Promise<ReferralLinkRow> {
  const link = await db.prepare(`SELECT rl.id, rl.code, rl.name, rl.referrer_user_id AS referrerUserId,
    COALESCE(cp.full_name, u.email, u.username, 'Referral partner') AS referrerName,
    COALESCE(u.email, '') AS referrerEmail, rl.discount_basis_points AS discountBasisPoints,
    rl.discount_scope AS discountScope, rl.commission_basis_points AS commissionBasisPoints,
    rl.attribution_days AS attributionDays, rl.starts_at AS startsAt, rl.ends_at AS endsAt, rl.status
    FROM referral_links rl JOIN users u ON u.id = rl.referrer_user_id
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id
    WHERE rl.code = ?`).bind(code).first<ReferralLinkRow>();
  const now = Math.floor(Date.now() / 1000);
  if (!link || link.status !== "ACTIVE" || (link.startsAt !== null && link.startsAt > now) || (link.endsAt !== null && link.endsAt < now)) {
    throw new ApiError(404, "REFERRAL_NOT_AVAILABLE", "That referral link is not currently available.");
  }
  return link;
}

export async function registrationReferralStatement(
  db: D1Database,
  userId: string,
  codeValue: unknown,
): Promise<D1PreparedStatement | null> {
  const code = normalizeReferralCode(codeValue);
  if (!code) return null;
  const link = await activeLink(db, code);
  if (link.referrerUserId === userId) return null;
  return db.prepare(`INSERT OR IGNORE INTO customer_referrals
    (user_id, referral_link_id, referrer_user_id, attribution_source, attributed_at)
    VALUES (?, ?, ?, 'SIGNUP', unixepoch())`).bind(userId, link.id, link.referrerUserId);
}

export async function resolveOrderReferral(
  db: D1Database,
  userId: string,
  codeValue: unknown,
  subtotalMinor: number,
  bundleDiscountMinor: number,
): Promise<OrderReferral> {
  const suppliedCode = normalizeReferralCode(codeValue);
  let link = await db.prepare(`SELECT rl.id, rl.code, rl.name, rl.referrer_user_id AS referrerUserId,
    COALESCE(cp.full_name, u.email, u.username, 'Referral partner') AS referrerName,
    COALESCE(u.email, '') AS referrerEmail, rl.discount_basis_points AS discountBasisPoints,
    rl.discount_scope AS discountScope, rl.commission_basis_points AS commissionBasisPoints,
    rl.attribution_days AS attributionDays, rl.starts_at AS startsAt, rl.ends_at AS endsAt, rl.status
    FROM customer_referrals cr JOIN referral_links rl ON rl.id = cr.referral_link_id
    JOIN users u ON u.id = rl.referrer_user_id LEFT JOIN customer_profiles cp ON cp.user_id = u.id
    WHERE cr.user_id = ?`).bind(userId).first<ReferralLinkRow>();
  let assignment: D1PreparedStatement | null = null;
  if (!link && suppliedCode) {
    link = await activeLink(db, suppliedCode);
    if (link.referrerUserId === userId) throw new ApiError(422, "SELF_REFERRAL_NOT_ALLOWED", "You cannot use your own referral link.");
    assignment = db.prepare(`INSERT INTO customer_referrals
      (user_id, referral_link_id, referrer_user_id, attribution_source, attributed_at)
      VALUES (?, ?, ?, 'ORDER', unixepoch())`).bind(userId, link.id, link.referrerUserId);
  }
  if (!link) return { link: null, discountMinor: 0, assignment: null };
  const now = Math.floor(Date.now() / 1000);
  const active = link.status === "ACTIVE" && (link.startsAt === null || link.startsAt <= now) && (link.endsAt === null || link.endsAt >= now);
  let eligible = active && link.discountScope !== "NONE" && link.discountBasisPoints > 0;
  if (eligible && link.discountScope === "FIRST_PURCHASE") {
    const prior = await db.prepare(`SELECT COUNT(*) AS count FROM orders
      WHERE user_id = ? AND status <> 'CANCELLED'`).bind(userId).first<{ count: number }>();
    eligible = Number(prior?.count ?? 0) === 0;
  }
  const eligibleSubtotal = Math.max(0, subtotalMinor - bundleDiscountMinor);
  const discountMinor = eligible ? Math.min(eligibleSubtotal, Math.round(eligibleSubtotal * link.discountBasisPoints / 10_000)) : 0;
  return { link, discountMinor, assignment };
}

export async function handleReferralResolve(request: Request, db: D1Database): Promise<Response> {
  assertSameOrigin(request);
  await consumeRateLimit(db, request, { bucket: "referral-resolve", limit: 60, windowSeconds: 10 * 60, code: "REFERRAL_RATE_LIMITED", message: "Too many referral checks. Please wait and try again." });
  const body = await readJson<Record<string, unknown>>(request);
  const code = normalizeReferralCode(body.code);
  if (!code) throw new ApiError(422, "REFERRAL_INVALID", "That referral link is not valid.");
  const link = await activeLink(db, code);
  const session = await getSession(request, db);
  let eligible = link.discountScope !== "NONE" && link.discountBasisPoints > 0;
  if (session?.user.role === "CUSTOMER") {
    if (session.user.id === link.referrerUserId) eligible = false;
    else if (eligible && link.discountScope === "FIRST_PURCHASE") {
      const prior = await db.prepare(`SELECT COUNT(*) AS count FROM orders
        WHERE user_id = ? AND status <> 'CANCELLED'`).bind(session.user.id).first<{ count: number }>();
      eligible = Number(prior?.count ?? 0) === 0;
    }
  }
  const visitorSeed = `${request.headers.get("cf-connecting-ip") ?? "unknown"}|${request.headers.get("user-agent") ?? "unknown"}`;
  await db.prepare(`INSERT INTO referral_visits (id, referral_link_id, visitor_hash, converted_user_id)
    VALUES (?, ?, ?, ?)`).bind(randomId("ref_visit"), link.id, await sha256(visitorSeed), session?.user.role === "CUSTOMER" ? session.user.id : null).run();
  return ok({
    code: link.code,
    name: link.name,
    referrerName: link.referrerName,
    discountPercent: link.discountBasisPoints / 100,
    discountScope: link.discountScope.toLowerCase(),
    attributionDays: Number(link.attributionDays),
    eligible,
    message: link.discountBasisPoints > 0
      ? `${link.discountBasisPoints / 100}% referral saving ${link.discountScope === "FIRST_PURCHASE" ? "on your first purchase" : "on every purchase"}.`
      : `You are shopping through ${link.referrerName}'s referral link.`,
  });
}

function unixTime(value: unknown, field: string): number | null {
  if (value === undefined || value === null || value === "") return null;
  const timestamp = Date.parse(String(value));
  if (!Number.isFinite(timestamp)) throw new ApiError(422, "VALIDATION_ERROR", "Enter a valid date.", { [field]: "Enter a valid date and time." });
  return Math.floor(timestamp / 1000);
}

async function adminLinks(db: D1Database) {
  const rows = await allRows<ReferralLinkRow & { visits: number; downlines: number; paidOrders: number; paidRevenueMinor: number; pendingMinor: number; approvedMinor: number; paidMinor: number }>(db.prepare(`SELECT rl.id, rl.code, rl.name, rl.referrer_user_id AS referrerUserId,
    COALESCE(cp.full_name, u.email, u.username, 'Referral partner') AS referrerName,
    COALESCE(u.email, '') AS referrerEmail, rl.discount_basis_points AS discountBasisPoints,
    rl.discount_scope AS discountScope, rl.commission_basis_points AS commissionBasisPoints,
    rl.attribution_days AS attributionDays, rl.starts_at AS startsAt, rl.ends_at AS endsAt, rl.status,
    (SELECT COUNT(*) FROM referral_visits rv WHERE rv.referral_link_id = rl.id) AS visits,
    (SELECT COUNT(*) FROM customer_referrals cr WHERE cr.referral_link_id = rl.id) AS downlines,
    (SELECT COUNT(*) FROM orders o WHERE o.referral_link_id = rl.id AND o.payment_status = 'PAID') AS paidOrders,
    (SELECT COALESCE(SUM(o.total_minor), 0) FROM orders o WHERE o.referral_link_id = rl.id AND o.payment_status = 'PAID') AS paidRevenueMinor,
    (SELECT COALESCE(SUM(rc.amount_minor), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'PENDING') AS pendingMinor,
    (SELECT COALESCE(SUM(rc.amount_minor), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'APPROVED') AS approvedMinor,
    (SELECT COALESCE(SUM(rc.amount_minor), 0) FROM referral_commissions rc WHERE rc.referral_link_id = rl.id AND rc.status = 'PAID') AS paidMinor
    FROM referral_links rl JOIN users u ON u.id = rl.referrer_user_id
    LEFT JOIN customer_profiles cp ON cp.user_id = u.id ORDER BY rl.created_at DESC`));
  return rows.map((row) => ({
    id: row.id, code: row.code, name: row.name, referrerUserId: row.referrerUserId,
    referrerName: row.referrerName, referrerEmail: row.referrerEmail,
    discountPercent: Number(row.discountBasisPoints) / 100,
    discountScope: row.discountScope.toLowerCase(), commissionPercent: Number(row.commissionBasisPoints) / 100,
    attributionDays: Number(row.attributionDays), active: row.status === "ACTIVE",
    startsAt: row.startsAt ? new Date(row.startsAt * 1000).toISOString() : undefined,
    endsAt: row.endsAt ? new Date(row.endsAt * 1000).toISOString() : undefined,
    visits: Number(row.visits), downlines: Number(row.downlines), paidOrders: Number(row.paidOrders),
    paidRevenue: Number(row.paidRevenueMinor) / 100, pendingCommission: Number(row.pendingMinor) / 100,
    approvedCommission: Number(row.approvedMinor) / 100, paidCommission: Number(row.paidMinor) / 100,
  }));
}

export async function handleAccountReferrals(request: Request, db: D1Database): Promise<Response> {
  const session = await requireCustomer(request, db);
  const links = (await adminLinks(db)).filter((link) => link.referrerUserId === session.user.id);
  const rows = await allRows<{ id: string; code: string; orderId: string; orderNumber: string; basisMinor: number; rateBasisPoints: number; amountMinor: number; status: string; note: string | null; createdAt: number; approvedAt: number | null; paidAt: number | null }>(db.prepare(`SELECT rc.id, rl.code, rc.order_id AS orderId, o.order_number AS orderNumber,
    rc.basis_minor AS basisMinor, rc.rate_basis_points AS rateBasisPoints, rc.amount_minor AS amountMinor,
    rc.status, rc.note, rc.created_at AS createdAt, rc.approved_at AS approvedAt, rc.paid_at AS paidAt
    FROM referral_commissions rc JOIN referral_links rl ON rl.id = rc.referral_link_id
    JOIN orders o ON o.id = rc.order_id WHERE rc.referrer_user_id = ? ORDER BY rc.created_at DESC`)
    .bind(session.user.id));
  const commissions = rows.map((row) => ({
    id: row.id, code: row.code, orderId: row.orderId, orderNumber: row.orderNumber,
    basis: Number(row.basisMinor) / 100, ratePercent: Number(row.rateBasisPoints) / 100,
    amount: Number(row.amountMinor) / 100, status: row.status.toLowerCase(), note: row.note,
    createdAt: new Date(row.createdAt * 1000).toISOString(),
    approvedAt: row.approvedAt ? new Date(row.approvedAt * 1000).toISOString() : undefined,
    paidAt: row.paidAt ? new Date(row.paidAt * 1000).toISOString() : undefined,
  }));
  const total = (status: string) => commissions.filter((item) => item.status === status)
    .reduce((sum, item) => sum + item.amount, 0);
  const pending = total("pending");
  const approved = total("approved");
  const paid = total("paid");
  return ok({ links, commissions, totals: { pending, approved, paid, earned: approved + paid } });
}

export async function handleAdminReferrals(request: Request, db: D1Database, id?: string): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ referrals: await adminLinks(db) });
  }
  const session = await requireAdmin(request, db, { mutation: true });
  if (request.method === "DELETE" && id) {
    const result = await db.prepare("UPDATE referral_links SET status = 'INACTIVE', updated_at = unixepoch() WHERE id = ?").bind(id).run();
    if (!result.meta.changes) throw new ApiError(404, "REFERRAL_NOT_FOUND", "The referral link could not be found.");
    await db.prepare(`INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id)
      VALUES (?, ?, 'DISABLE', 'REFERRAL_LINK', ?)`).bind(randomId("audit"), session.user.id, id).run();
    return ok({ deleted: true });
  }
  const body = await readJson<Record<string, unknown>>(request);
  const code = normalizeReferralCode(requiredString(body.code, "code", { min: 2, max: 50 }))!;
  const name = requiredString(body.name, "name", { min: 2, max: 160 });
  const referrerUserId = requiredString(body.referrerUserId, "referrerUserId", { min: 2, max: 100 });
  const owner = await db.prepare("SELECT id FROM users WHERE id = ? AND role = 'CUSTOMER' AND status = 'ACTIVE'").bind(referrerUserId).first<{ id: string }>();
  if (!owner) throw new ApiError(422, "REFERRER_NOT_FOUND", "Choose an active customer as the referral owner.");
  const discountBasisPoints = Math.round(Number(body.discountPercent ?? 0) * 100);
  const commissionBasisPoints = Math.round(Number(body.commissionPercent ?? 0) * 100);
  if (!Number.isSafeInteger(discountBasisPoints) || discountBasisPoints < 0 || discountBasisPoints > 10_000) throw new ApiError(422, "VALIDATION_ERROR", "Discount must be between 0 and 100%.");
  if (!Number.isSafeInteger(commissionBasisPoints) || commissionBasisPoints < 0 || commissionBasisPoints > 10_000) throw new ApiError(422, "VALIDATION_ERROR", "Commission must be between 0 and 100%.");
  const discountScope = requiredString(body.discountScope ?? "FIRST_PURCHASE", "discountScope", { min: 4, max: 30 }).toUpperCase();
  if (!["NONE", "FIRST_PURCHASE", "EVERY_PURCHASE"].includes(discountScope)) throw new ApiError(422, "VALIDATION_ERROR", "Choose first purchase, every purchase or no discount.");
  const attributionDays = integerField(Number(body.attributionDays ?? 30), "attributionDays", { min: 1, max: 365 });
  const startsAt = unixTime(body.startsAt, "startsAt");
  const endsAt = unixTime(body.endsAt, "endsAt");
  if (startsAt && endsAt && endsAt <= startsAt) throw new ApiError(422, "VALIDATION_ERROR", "The end date must be after the start date.");
  const status = booleanField(body.active, true) ? "ACTIVE" : "INACTIVE";
  const linkId = id ?? randomId("referral");
  try {
    if (id) {
      const result = await db.prepare(`UPDATE referral_links SET code = ?, name = ?, referrer_user_id = ?, discount_basis_points = ?,
        discount_scope = ?, commission_basis_points = ?, attribution_days = ?, starts_at = ?, ends_at = ?, status = ?, updated_at = unixepoch() WHERE id = ?`)
        .bind(code, name, referrerUserId, discountBasisPoints, discountScope, commissionBasisPoints, attributionDays, startsAt, endsAt, status, id).run();
      if (!result.meta.changes) throw new ApiError(404, "REFERRAL_NOT_FOUND", "The referral link could not be found.");
    } else {
      await db.prepare(`INSERT INTO referral_links
        (id, code, name, referrer_user_id, discount_basis_points, discount_scope, commission_basis_points, attribution_days, starts_at, ends_at, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(linkId, code, name, referrerUserId, discountBasisPoints, discountScope, commissionBasisPoints, attributionDays, startsAt, endsAt, status).run();
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(409, "REFERRAL_CODE_EXISTS", "That referral code is already in use.");
  }
  await db.prepare(`INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json)
    VALUES (?, ?, ?, 'REFERRAL_LINK', ?, ?)`).bind(randomId("audit"), session.user.id, id ? "UPDATE" : "CREATE", linkId, JSON.stringify(body)).run();
  return ok({ referral: (await adminLinks(db)).find((link) => link.id === linkId) }, id ? 200 : 201);
}

async function adminCommissions(db: D1Database) {
  const rows = await allRows<{ id: string; code: string; orderId: string; orderNumber: string; referrerName: string; customerName: string; basisMinor: number; rateBasisPoints: number; amountMinor: number; status: string; note: string | null; createdAt: number; approvedAt: number | null; paidAt: number | null }>(db.prepare(`SELECT rc.id, rl.code, rc.order_id AS orderId, o.order_number AS orderNumber,
    COALESCE(rp.full_name, ru.email, 'Referral partner') AS referrerName,
    COALESCE(cp.full_name, o.customer_name) AS customerName, rc.basis_minor AS basisMinor,
    rc.rate_basis_points AS rateBasisPoints, rc.amount_minor AS amountMinor, rc.status, rc.note,
    rc.created_at AS createdAt, rc.approved_at AS approvedAt, rc.paid_at AS paidAt
    FROM referral_commissions rc JOIN referral_links rl ON rl.id = rc.referral_link_id
    JOIN orders o ON o.id = rc.order_id JOIN users ru ON ru.id = rc.referrer_user_id
    LEFT JOIN customer_profiles rp ON rp.user_id = ru.id LEFT JOIN customer_profiles cp ON cp.user_id = rc.referred_user_id
    ORDER BY rc.created_at DESC`));
  return rows.map((row) => ({ id: row.id, code: row.code, orderId: row.orderId, orderNumber: row.orderNumber,
    referrerName: row.referrerName, customerName: row.customerName, basis: Number(row.basisMinor) / 100,
    ratePercent: Number(row.rateBasisPoints) / 100, amount: Number(row.amountMinor) / 100,
    status: row.status.toLowerCase(), note: row.note, createdAt: new Date(row.createdAt * 1000).toISOString(),
    approvedAt: row.approvedAt ? new Date(row.approvedAt * 1000).toISOString() : undefined,
    paidAt: row.paidAt ? new Date(row.paidAt * 1000).toISOString() : undefined }));
}

export async function handleAdminReferralCommissions(request: Request, db: D1Database, id?: string): Promise<Response> {
  if (request.method === "GET" && !id) {
    await requireAdmin(request, db);
    return ok({ commissions: await adminCommissions(db) });
  }
  if (!id) throw new ApiError(404, "COMMISSION_NOT_FOUND", "The commission could not be found.");
  const session = await requireAdmin(request, db, { mutation: true });
  const body = await readJson<Record<string, unknown>>(request);
  const status = requiredString(body.status, "status", { min: 3, max: 20 }).toUpperCase();
  if (!["PAID", "VOID"].includes(status)) throw new ApiError(422, "VALIDATION_ERROR", "Choose paid or void.");
  const note = optionalString(body.note, "note", 1000);
  const result = await db.prepare(`UPDATE referral_commissions SET status = ?, note = ?,
    paid_at = CASE WHEN ? = 'PAID' THEN unixepoch() ELSE paid_at END,
    voided_at = CASE WHEN ? = 'VOID' THEN unixepoch() ELSE voided_at END, updated_at = unixepoch()
    WHERE id = ? AND ((? = 'PAID' AND status = 'APPROVED') OR (? = 'VOID' AND status IN ('PENDING','APPROVED')))`)
    .bind(status, note, status, status, id, status, status).run();
  if (!result.meta.changes) throw new ApiError(409, "COMMISSION_STATUS_INVALID", "That commission cannot move to the selected status.");
  await db.prepare(`INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json)
    VALUES (?, ?, ?, 'REFERRAL_COMMISSION', ?, ?)`).bind(randomId("audit"), session.user.id, status, id, JSON.stringify({ status, note })).run();
  return ok({ commission: (await adminCommissions(db)).find((commission) => commission.id === id) });
}
