import {
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleRegister,
  handleSession,
} from "./auth";
import { requireAdmin } from "./auth";
import {
  handleAccountOrders,
  handleCreateAddress,
  handleDeleteAddress,
  handleGetProfile,
  handleListAddresses,
  handlePatchProfile,
  handleUpdateAddress,
} from "./account";
import {
  handleAdminBundles,
  handleAdminCustomers,
  handleAdminDashboard,
  handleAdminEnquiries,
  handleAdminOrders,
  handleAdminProducts,
  handleAdminPromos,
  handleAdminSettings,
  handleAdminStaff,
  handleAdminSlides,
} from "./admin";
import {
  handleCreateEnquiry,
  handleCreateOrder,
  handleNewsletter,
  handlePromoValidation,
} from "./commerce";
import { ensureDatabase, runDatabaseMaintenance } from "./database";
import type { Env } from "./env";
import { apiExceptionResponse, fail, methodNotAllowed } from "./http";
import { handleAdminUpload, handleCustomerReceiptUpload, handleDeleteUpload, handleMedia, handlePaymentReceiptFile, handlePaymentReceiptReview } from "./media";
import { handleStorefront } from "./storefront";
import { handleAccountReferrals, handleAdminReferralCommissions, handleAdminReferrals, handleReferralResolve } from "./referrals";

function oneOf(method: string, allowed: string[]): Response | null {
  return allowed.includes(method) ? null : methodNotAllowed(allowed);
}

export async function handleApi(request: Request, env: Env): Promise<Response> {
  try {
    return await dispatchApi(request, env);
  } catch (error) {
    return apiExceptionResponse(error);
  }
}

async function dispatchApi(request: Request, env: Env): Promise<Response> {
  if (!env.DB) return fail(503, "DATABASE_UNAVAILABLE", "The store database is not configured.");
  await ensureDatabase(env.DB);
  await runDatabaseMaintenance(env.DB);
  const url = new URL(request.url);
  const path = url.pathname.slice("/api/v1".length).replace(/\/$/u, "") || "/";
  const method = request.method.toUpperCase();

    if (path === "/health") {
      const rejected = oneOf(method, ["GET", "HEAD"]);
      if (rejected) return rejected;
      const schema = await env.DB.prepare("SELECT value FROM app_state WHERE key = 'schema_version'").first<{ value: string }>();
      if (!schema?.value) return fail(503, "DATABASE_NOT_READY", "The store database is not ready.");
      const response = new Response(JSON.stringify({ ok: true, data: { status: "ok" } }), {
        status: 200,
        headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" },
      });
      return method === "HEAD" ? new Response(null, { status: response.status, headers: response.headers }) : response;
    }

    if (path === "/storefront") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleStorefront(env.DB);
    }
    if (path === "/auth/register") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleRegister(request, env.DB);
    }
    if (path === "/auth/login") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleLogin(request, env.DB, false, env.ADMIN_BOOTSTRAP_IPS);
    }
    if (path === "/auth/logout") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleLogout(request, env.DB);
    }
    if (path === "/auth/session") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleSession(request, env.DB);
    }
    if (path === "/auth/change-password") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleChangePassword(request, env.DB, env.ADMIN_BOOTSTRAP_IPS);
    }
    if (path === "/admin/login") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleLogin(request, env.DB, true, env.ADMIN_BOOTSTRAP_IPS);
    }
    if (path === "/admin/logout") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleLogout(request, env.DB);
    }
    if (path === "/admin/session") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleSession(request, env.DB, true);
    }

    if (path === "/profile") {
      const rejected = oneOf(method, ["GET", "PATCH"]);
      if (rejected) return rejected;
      return method === "GET" ? handleGetProfile(request, env.DB) : handlePatchProfile(request, env.DB);
    }
    if (path === "/profile/addresses") {
      const rejected = oneOf(method, ["GET", "POST"]);
      if (rejected) return rejected;
      return method === "GET" ? handleListAddresses(request, env.DB) : handleCreateAddress(request, env.DB);
    }
    const addressMatch = path.match(/^\/profile\/addresses\/([^/]+)$/u);
    if (addressMatch) {
      const rejected = oneOf(method, ["PATCH", "PUT", "DELETE"]);
      if (rejected) return rejected;
      const id = decodeURIComponent(addressMatch[1]);
      return method === "DELETE"
        ? handleDeleteAddress(request, env.DB, id)
        : handleUpdateAddress(request, env.DB, id);
    }
    if (path === "/orders") {
      const rejected = oneOf(method, ["GET", "POST"]);
      if (rejected) return rejected;
      return method === "GET" ? handleAccountOrders(request, env.DB) : handleCreateOrder(request, env.DB);
    }
    if (path === "/account/referrals") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAccountReferrals(request, env.DB);
    }
    const orderReceiptMatch = path.match(/^\/orders\/([^/]+)\/receipt$/u);
    if (orderReceiptMatch) {
      const rejected = oneOf(method, ["POST"]);
      if (rejected) return rejected;
      if (!env.MEDIA) return fail(503, "MEDIA_UNAVAILABLE", "Receipt storage is not configured.");
      return handleCustomerReceiptUpload(request, env, decodeURIComponent(orderReceiptMatch[1]));
    }
    if (path === "/promos/validate") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handlePromoValidation(request, env.DB);
    }
    if (path === "/referrals/resolve") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleReferralResolve(request, env.DB);
    }
    if (path === "/newsletter") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleNewsletter(request, env.DB);
    }
    if (path === "/enquiries") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleCreateEnquiry(request, env.DB);
    }

    if (path.startsWith("/admin/")) {
      const permission = path.startsWith("/admin/orders") || path.startsWith("/admin/payment-receipts") ? "orders"
        : path.startsWith("/admin/customers") ? "customers"
          : path.startsWith("/admin/promos") ? "promos"
            : path.startsWith("/admin/referral") ? "referrals"
            : path.startsWith("/admin/enquiries") ? "enquiries"
              : path.startsWith("/admin/products") || path.startsWith("/admin/slides") || path.startsWith("/admin/bundles") || path.startsWith("/admin/uploads") ? "content"
                : path === "/admin/dashboard" ? "dashboard" : null;
      if (permission) await requireAdmin(request, env.DB, { allowMustChange: true, permission });
    }

    if (path === "/admin/dashboard") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminDashboard(request, env.DB);
    }
    if (path === "/admin/settings") {
      const rejected = oneOf(method, ["GET", "PATCH"]);
      return rejected ?? handleAdminSettings(request, env.DB);
    }
    if (path === "/admin/staff") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminStaff(request, env.DB);
    }
    const staffMatch = path.match(/^\/admin\/staff\/([^/]+)$/u);
    if (staffMatch) {
      const rejected = oneOf(method, ["PATCH"]);
      return rejected ?? handleAdminStaff(request, env.DB, decodeURIComponent(staffMatch[1]));
    }
    const receiptFileMatch = path.match(/^\/admin\/payment-receipts\/([^/]+)\/file$/u);
    if (receiptFileMatch) {
      const rejected = oneOf(method, ["GET"]);
      if (rejected) return rejected;
      return handlePaymentReceiptFile(request, env, decodeURIComponent(receiptFileMatch[1]));
    }
    const receiptReviewMatch = path.match(/^\/admin\/payment-receipts\/([^/]+)$/u);
    if (receiptReviewMatch) {
      const rejected = oneOf(method, ["PATCH"]);
      if (rejected) return rejected;
      return handlePaymentReceiptReview(request, env, decodeURIComponent(receiptReviewMatch[1]));
    }
    if (path === "/admin/products") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminProducts(request, env.DB);
    }
    const productMatch = path.match(/^\/admin\/products\/([^/]+)$/u);
    if (productMatch) {
      const rejected = oneOf(method, ["GET", "PATCH", "DELETE"]);
      if (rejected) return rejected;
      if (method === "GET") return fail(405, "METHOD_NOT_ALLOWED", "Use the admin products list to read products.");
      return handleAdminProducts(request, env.DB, decodeURIComponent(productMatch[1]));
    }
    if (path === "/admin/slides") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminSlides(request, env.DB);
    }
    const slideMatch = path.match(/^\/admin\/slides\/([^/]+)$/u);
    if (slideMatch) {
      const rejected = oneOf(method, ["PATCH", "DELETE"]);
      return rejected ?? handleAdminSlides(request, env.DB, decodeURIComponent(slideMatch[1]));
    }
    if (path === "/admin/bundles") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminBundles(request, env.DB);
    }
    const bundleMatch = path.match(/^\/admin\/bundles\/([^/]+)$/u);
    if (bundleMatch) {
      const rejected = oneOf(method, ["PATCH", "DELETE"]);
      if (rejected) return rejected;
      if (method === "DELETE") return fail(405, "METHOD_NOT_ALLOWED", "Archive the bundle by setting active to false.");
      return handleAdminBundles(request, env.DB, decodeURIComponent(bundleMatch[1]));
    }
    if (path === "/admin/promos") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminPromos(request, env.DB);
    }
    const promoMatch = path.match(/^\/admin\/promos\/([^/]+)$/u);
    if (promoMatch) {
      const rejected = oneOf(method, ["PATCH", "DELETE"]);
      return rejected ?? handleAdminPromos(request, env.DB, decodeURIComponent(promoMatch[1]));
    }
    if (path === "/admin/referrals") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminReferrals(request, env.DB);
    }
    const referralMatch = path.match(/^\/admin\/referrals\/([^/]+)$/u);
    if (referralMatch) {
      const rejected = oneOf(method, ["PATCH", "DELETE"]);
      return rejected ?? handleAdminReferrals(request, env.DB, decodeURIComponent(referralMatch[1]));
    }
    if (path === "/admin/referral-commissions") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminReferralCommissions(request, env.DB);
    }
    const commissionMatch = path.match(/^\/admin\/referral-commissions\/([^/]+)$/u);
    if (commissionMatch) {
      const rejected = oneOf(method, ["PATCH"]);
      return rejected ?? handleAdminReferralCommissions(request, env.DB, decodeURIComponent(commissionMatch[1]));
    }
    if (path === "/admin/orders") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminOrders(request, env.DB);
    }
    const orderMatch = path.match(/^\/admin\/orders\/([^/]+)$/u);
    if (orderMatch) {
      const rejected = oneOf(method, ["PATCH"]);
      return rejected ?? handleAdminOrders(request, env.DB, decodeURIComponent(orderMatch[1]));
    }
    if (path === "/admin/customers") {
      const rejected = oneOf(method, ["GET", "POST"]);
      return rejected ?? handleAdminCustomers(request, env.DB);
    }
    const customerMatch = path.match(/^\/admin\/customers\/([^/]+)$/u);
    if (customerMatch) {
      const rejected = oneOf(method, ["GET", "PATCH", "DELETE"]);
      return rejected ?? handleAdminCustomers(request, env.DB, decodeURIComponent(customerMatch[1]));
    }
    if (path === "/admin/enquiries") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminEnquiries(request, env.DB);
    }
    const enquiryReplyMatch = path.match(/^\/admin\/enquiries\/([^/]+)\/replies$/u);
    if (enquiryReplyMatch) {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleAdminEnquiries(request, env.DB, decodeURIComponent(enquiryReplyMatch[1]), true);
    }
    const enquiryMatch = path.match(/^\/admin\/enquiries\/([^/]+)$/u);
    if (enquiryMatch) {
      const rejected = oneOf(method, ["PATCH"]);
      return rejected ?? handleAdminEnquiries(request, env.DB, decodeURIComponent(enquiryMatch[1]));
    }
    if (path === "/admin/uploads") {
      const rejected = oneOf(method, ["POST"]);
      if (rejected) return rejected;
      if (!env.MEDIA) return fail(503, "MEDIA_UNAVAILABLE", "Image storage is not configured.");
      return handleAdminUpload(request, env);
    }
    const uploadMatch = path.match(/^\/admin\/uploads\/([^/]+)$/u);
    if (uploadMatch) {
      const rejected = oneOf(method, ["DELETE"]);
      if (rejected) return rejected;
      if (!env.MEDIA) return fail(503, "MEDIA_UNAVAILABLE", "Image storage is not configured.");
      return handleDeleteUpload(request, env, decodeURIComponent(uploadMatch[1]));
    }
    const mediaMatch = path.match(/^\/media\/([^/]+)$/u);
    if (mediaMatch) {
      const rejected = oneOf(method, ["GET", "HEAD"]);
      if (rejected) return rejected;
      if (!env.MEDIA) return fail(503, "MEDIA_UNAVAILABLE", "Image storage is not configured.");
      return handleMedia(request, env, decodeURIComponent(mediaMatch[1]));
    }

  return fail(404, "API_NOT_FOUND", "That API endpoint does not exist.");
}
