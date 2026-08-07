import { requireAdmin } from "./auth";
import { randomId, sha256 } from "./crypto";
import type { Env } from "./env";
import { ApiError, ok, optionalString } from "./http";

const allowedTypes = new Map([
  ["image/jpeg", "jpg"],
  ["image/png", "png"],
  ["image/webp", "webp"],
]);

function validSignature(type: string, bytes: Uint8Array): boolean {
  if (type === "image/jpeg") return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (type === "image/png") return bytes.slice(0, 8).every((byte, index) => byte === [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a][index]);
  if (type === "image/webp") {
    return new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP";
  }
  return false;
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
