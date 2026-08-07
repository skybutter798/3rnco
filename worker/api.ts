import {
  handleChangePassword,
  handleLogin,
  handleLogout,
  handleRegister,
  handleSession,
} from "./auth";
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
import { handleAdminUpload, handleDeleteUpload, handleMedia } from "./media";
import { handleStorefront } from "./storefront";

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
    if (path === "/promos/validate") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handlePromoValidation(request, env.DB);
    }
    if (path === "/newsletter") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleNewsletter(request, env.DB);
    }
    if (path === "/enquiries") {
      const rejected = oneOf(method, ["POST"]);
      return rejected ?? handleCreateEnquiry(request, env.DB);
    }

    if (path === "/admin/dashboard") {
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminDashboard(request, env.DB);
    }
    if (path === "/admin/settings") {
      const rejected = oneOf(method, ["GET", "PATCH"]);
      return rejected ?? handleAdminSettings(request, env.DB);
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
      const rejected = oneOf(method, ["GET"]);
      return rejected ?? handleAdminCustomers(request, env.DB);
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
