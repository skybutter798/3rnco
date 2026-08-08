import { requireAdmin, requireCustomer, verifyCsrf } from "./auth";
import { randomId, sha256 } from "./crypto";
import type { Env } from "./env";
import { ApiError, ok, optionalString } from "./http";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

const receiptTypes = new Map([...allowedTypes, ["application/pdf", "pdf"]]);

function validSignature(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (type === "image/webp") {
    return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  if (type === "application/pdf") return new TextDecoder().decode(bytes.slice(0, 5)) === "%PDF-";
  return false;
}

function receiptPayload(row: { id: string; status: string; paymentMethodId: string; paymentMethodName?: string | null; customerReference: string | null; customerNote: string | null; originalName: string; mimeType: string; sizeBytes: number; reviewNote: string | null; createdAt: number; reviewedAt: number | null }) {
  return { id: row.id, status: row.status.toLowerCase(), paymentMethodId: row.paymentMethodId, paymentMethodName: row.paymentMethodName ?? undefined, customerReference: row.customerReference, customerNote: row.customerNote, originalName: row.originalName, mimeType: row.mimeType, sizeBytes: row.sizeBytes, reviewNote: row.reviewNote, createdAt: new Date(row.createdAt * 1000).toISOString(), reviewedAt: row.reviewedAt ? new Date(row.reviewedAt * 1000).toISOString() : null };
}

export async function handleCustomerReceiptUpload(request: Request, env: Env, orderId: string): Promise<Response> {
  const session = await requireCustomer(request, env.DB);
  await verifyCsrf(request, session);
  const order = await env.DB.prepare("SELECT id, status, payment_status AS paymentStatus FROM orders WHERE id = ? AND user_id = ?").bind(orderId, session.user.id).first<{ id: string; status: string; paymentStatus: string }>();
  if (!order) throw new ApiError(404, "ORDER_NOT_FOUND", "The order could not be found.");
  if (order.status !== "PENDING_PAYMENT" || order.paymentStatus !== "PENDING") throw new ApiError(409, "ORDER_NOT_AWAITING_PAYMENT", "This order is not waiting for payment.");
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 8_500_000) throw new ApiError(413, "RECEIPT_TOO_LARGE", "Receipts must be 8 MB or smaller.");
  const form = await request.formData();
  const value = form.get("file") ?? form.get("receipt");
  if (!(value instanceof File)) throw new ApiError(422, "RECEIPT_REQUIRED", "Choose a receipt image or PDF.");
  if (!receiptTypes.has(value.type) || value.size < 1 || value.size > 8_000_000) throw new ApiError(422, "RECEIPT_TYPE_NOT_ALLOWED", "Upload a JPEG, PNG, WebP or PDF receipt up to 8 MB.");
  const methodId = optionalString(form.get("paymentMethodId"), "paymentMethodId", 64) ?? "";
  const method = await env.DB.prepare("SELECT id FROM payment_methods WHERE id = ? AND enabled = 1").bind(methodId).first<{ id: string }>();
  if (!method) throw new ApiError(422, "PAYMENT_METHOD_UNAVAILABLE", "Choose an available payment method.");
  const existing = await env.DB.prepare("SELECT id FROM payment_receipts WHERE order_id = ? AND status IN ('SUBMITTED','VERIFIED') LIMIT 1").bind(orderId).first<{ id: string }>();
  if (existing) throw new ApiError(409, "RECEIPT_ALREADY_SUBMITTED", "A receipt is already under review for this order.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!validSignature(value.type, bytes)) throw new ApiError(422, "INVALID_RECEIPT", "The uploaded receipt is not a valid file.");
  const id = randomId("receipt");
  const now = new Date();
  const key = `payment-receipts/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${receiptTypes.get(value.type)}`;
  await env.MEDIA.put(key, bytes, { httpMetadata: { contentType: value.type, cacheControl: "private, no-store" }, customMetadata: { userId: session.user.id, orderId } });
  const reference = optionalString(form.get("customerReference"), "customerReference", 160);
  const note = optionalString(form.get("customerNote"), "customerNote", 1000);
  try {
    await env.DB.prepare(`INSERT INTO payment_receipts (id, order_id, user_id, payment_method_id, storage_key, original_name, mime_type, size_bytes, sha256, customer_reference, customer_note)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(id, orderId, session.user.id, methodId, key, value.name.slice(0, 255), value.type, value.size, await sha256(bytes), reference, note).run();
  } catch (error) {
    await env.MEDIA.delete(key);
    throw error;
  }
  return ok({ receipt: { id, status: "submitted", paymentMethodId: methodId, customerReference: reference, customerNote: note, originalName: value.name, mimeType: value.type, sizeBytes: value.size, createdAt: now.toISOString() } }, 201);
}

export async function handlePaymentReceiptFile(request: Request, env: Env, id: string): Promise<Response> {
  await requireAdmin(request, env.DB);
  const receipt = await env.DB.prepare("SELECT storage_key AS storageKey, mime_type AS mimeType, original_name AS originalName FROM payment_receipts WHERE id = ?").bind(id).first<{ storageKey: string; mimeType: string; originalName: string }>();
  if (!receipt) throw new ApiError(404, "RECEIPT_NOT_FOUND", "The payment receipt could not be found.");
  const object = await env.MEDIA.get(receipt.storageKey);
  if (!object) throw new ApiError(404, "RECEIPT_FILE_NOT_FOUND", "The receipt file is unavailable.");
  return new Response(object.body, { headers: { "content-type": receipt.mimeType, "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(receipt.originalName)}`, "cache-control": "private, no-store", "content-security-policy": "default-src 'none'; sandbox", "x-content-type-options": "nosniff" } });
}

export async function handlePaymentReceiptReview(request: Request, env: Env, id: string): Promise<Response> {
  const session = await requireAdmin(request, env.DB, { mutation: true });
  const body = await request.json() as Record<string, unknown>;
  const status = optionalString(body.status, "status", 20)?.toUpperCase();
  if (!status || !["VERIFIED", "REJECTED"].includes(status)) throw new ApiError(422, "VALIDATION_ERROR", "Choose verified or rejected.");
  const reviewNote = optionalString(body.reviewNote, "reviewNote", 1000);
  const current = await env.DB.prepare("SELECT order_id AS orderId, status FROM payment_receipts WHERE id = ?").bind(id).first<{ orderId: string; status: string }>();
  if (!current) throw new ApiError(404, "RECEIPT_NOT_FOUND", "The payment receipt could not be found.");
  if (current.status !== "SUBMITTED") throw new ApiError(409, "RECEIPT_ALREADY_REVIEWED", "This receipt has already been reviewed.");
  const statements = [
    env.DB.prepare("UPDATE payment_receipts SET status = ?, review_note = ?, reviewed_by = ?, reviewed_at = unixepoch(), updated_at = unixepoch() WHERE id = ? AND status = 'SUBMITTED'").bind(status, reviewNote, session.user.id, id),
    env.DB.prepare("INSERT INTO admin_audit_logs (id, actor_user_id, action, entity_type, entity_id, after_json) VALUES (?, ?, ?, 'PAYMENT_RECEIPT', ?, ?)").bind(randomId("audit"), session.user.id, status, id, JSON.stringify({ status, reviewNote })),
  ];
  if (status === "VERIFIED") statements.push(env.DB.prepare("UPDATE orders SET status = 'PAYMENT_CONFIRMED', payment_status = 'PAID', updated_at = unixepoch() WHERE id = ? AND status = 'PENDING_PAYMENT' AND payment_status = 'PENDING'").bind(current.orderId));
  await env.DB.batch(statements);
  const saved = await env.DB.prepare(`SELECT r.id, r.status, r.payment_method_id AS paymentMethodId, m.display_name AS paymentMethodName,
    r.customer_reference AS customerReference, r.customer_note AS customerNote, r.original_name AS originalName,
    r.mime_type AS mimeType, r.size_bytes AS sizeBytes, r.review_note AS reviewNote, r.created_at AS createdAt, r.reviewed_at AS reviewedAt
    FROM payment_receipts r JOIN payment_methods m ON m.id = r.payment_method_id WHERE r.id = ?`).bind(id).first<{ id: string; status: string; paymentMethodId: string; paymentMethodName: string; customerReference: string | null; customerNote: string | null; originalName: string; mimeType: string; sizeBytes: number; reviewNote: string | null; createdAt: number; reviewedAt: number | null }>();
  return ok({ receipt: receiptPayload(saved!) });
}

export async function handleAdminUpload(request: Request, env: Env): Promise<Response> {
  const session = await requireAdmin(request, env.DB, { mutation: true });
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 8_500_000) throw new ApiError(413, "UPLOAD_TOO_LARGE", "Images must be 8 MB or smaller.");
  if (!request.headers.get("content-type")?.toLowerCase().includes("multipart/form-data")) {
    throw new ApiError(415, "UNSUPPORTED_MEDIA_TYPE", "Upload an image using multipart/form-data.");
  }
  const form = await request.formData();
  const value = form.get("file");
  if (!(value instanceof File)) throw new ApiError(422, "FILE_REQUIRED", "Choose an image to upload.");
  if (!allowedTypes.has(value.type)) throw new ApiError(422, "IMAGE_TYPE_NOT_ALLOWED", "Use a JPEG, PNG or WebP image.");
  if (value.size <= 0 || value.size > 8_000_000) throw new ApiError(413, "UPLOAD_TOO_LARGE", "Images must be 8 MB or smaller.");
  const bytes = new Uint8Array(await value.arrayBuffer());
  if (!validSignature(value.type, bytes)) throw new ApiError(422, "INVALID_IMAGE", "The uploaded file is not a valid image.");
  const extension = allowedTypes.get(value.type)!;
  const now = new Date();
  const id = randomId("media");
  const key = `uploads/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/${id}.${extension}`;
  await env.MEDIA.put(key, bytes, {
    httpMetadata: { contentType: value.type, cacheControl: "public, max-age=31536000, immutable" },
    customMetadata: { uploadedBy: session.user.id },
  });
  const url = `${new URL(request.url).origin}/api/v1/media/${encodeURIComponent(id)}`;
  const altText = optionalString(form.get("altText"), "altText", 300) ?? "";
  await env.DB.prepare(`INSERT INTO media_assets
    (id, storage_provider, storage_key, public_url, mime_type, size_bytes, sha256, alt_text, created_by)
    VALUES (?, 'R2', ?, ?, ?, ?, ?, ?, ?)`)
    .bind(id, key, url, value.type, value.size, await sha256(bytes), altText, session.user.id).run();
  const media = { id, url, mimeType: value.type, width: null, height: null, sizeBytes: value.size, altText };
  return ok({ media, url }, 201);
}

export async function handleMedia(request: Request, env: Env, id: string): Promise<Response> {
  const media = await env.DB.prepare(`SELECT storage_provider AS storageProvider,
    storage_key AS storageKey, public_url AS publicUrl, mime_type AS mimeType,
    alt_text AS altText FROM media_assets WHERE id = ?`).bind(id).first<{
      storageProvider: string; storageKey: string; publicUrl: string; mimeType: string; altText: string;
    }>();
  if (!media) throw new ApiError(404, "MEDIA_NOT_FOUND", "The image could not be found.");
  if (media.storageProvider !== "R2") return Response.redirect(media.publicUrl, 302);
  const object = await env.MEDIA.get(media.storageKey);
  if (!object) throw new ApiError(404, "MEDIA_NOT_FOUND", "The image could not be found.");
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set("content-type", media.mimeType);
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("content-security-policy", "default-src 'none'; style-src 'unsafe-inline'; sandbox");
  headers.set("x-content-type-options", "nosniff");
  headers.set("etag", object.httpEtag);
  return new Response(object.body, { headers });
}

export async function handleDeleteUpload(request: Request, env: Env, id: string): Promise<Response> {
  const session = await requireAdmin(request, env.DB, { mutation: true });
  const media = await env.DB.prepare(`SELECT storage_provider AS storageProvider,
    storage_key AS storageKey, public_url AS publicUrl FROM media_assets WHERE id = ?`)
    .bind(id).first<{ storageProvider: string; storageKey: string; publicUrl: string }>();
  if (!media) throw new ApiError(404, "MEDIA_NOT_FOUND", "The image could not be found.");
  const reference = await env.DB.prepare(`SELECT 1 AS found FROM product_media WHERE media_id = ? OR image_url = ?
    UNION SELECT 1 FROM slides WHERE media_id = ? OR image_url = ?
    UNION SELECT 1 FROM gallery_items WHERE media_id = ? OR image_url = ? LIMIT 1`)
    .bind(id, media.publicUrl, id, media.publicUrl, id, media.publicUrl).first<{ found: number }>();
  if (reference) throw new ApiError(409, "MEDIA_IN_USE", "Remove this image from products or sliders before deleting it.");
  await env.DB.batch([
    env.DB.prepare("DELETE FROM media_assets WHERE id = ?").bind(id),
    env.DB.prepare(`INSERT INTO admin_audit_logs
      (id, actor_user_id, action, entity_type, entity_id)
      VALUES (?, ?, 'DELETE', 'MEDIA', ?)`)
      .bind(randomId("audit"), session.user.id, id),
  ]);
  if (media.storageProvider === "R2") await env.MEDIA.delete(media.storageKey);
  return ok({ deleted: true });
}
