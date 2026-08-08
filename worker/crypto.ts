const encoder = new TextEncoder();

const PBKDF2_ITERATIONS = 600_000;
const PBKDF2_BYTES = 32;

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary)
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/u, "");
}

function fromBase64Url(value: string): Uint8Array {
  const base64 = value
    .replaceAll("-", "+")
    .replaceAll("_", "/")
    .padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(base64);
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

export function randomToken(byteLength = 32): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

export function randomId(prefix: string): string {
  return `${prefix}_${randomToken(18)}`;
}

export async function sha256(
  value: string | ArrayBuffer | Uint8Array,
): Promise<string> {
  const input =
    typeof value === "string"
      ? encoder.encode(value)
      : value instanceof Uint8Array
        ? value
        : new Uint8Array(value);
  const ownedInput = Uint8Array.from(input).buffer;
  return toBase64Url(
    new Uint8Array(await crypto.subtle.digest("SHA-256", ownedInput)),
  );
}

async function derivePassword(
  password: string,
  salt: Uint8Array,
  iterations: number,
): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    Uint8Array.from(encoder.encode(password)).buffer,
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: Uint8Array.from(salt).buffer,
      iterations,
    },
    key,
    PBKDF2_BYTES * 8,
  );
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = new Uint8Array(16);
  crypto.getRandomValues(salt);
  const derived = await derivePassword(password, salt, PBKDF2_ITERATIONS);
  return `pbkdf2-sha256$${PBKDF2_ITERATIONS}$${toBase64Url(salt)}$${toBase64Url(derived)}`;
}

export async function verifyPassword(
  password: string,
  encoded: string,
): Promise<boolean> {
  const [algorithm, iterationText, saltText, expectedText] = encoded.split("$");
  const iterations = Number(iterationText);
  if (
    algorithm !== "pbkdf2-sha256" ||
    !Number.isSafeInteger(iterations) ||
    iterations < 100_000 ||
    !saltText ||
    !expectedText
  )
    return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64Url(saltText);
    expected = fromBase64Url(expectedText);
  } catch {
    return false;
  }
  if (salt.byteLength < 16 || expected.byteLength !== PBKDF2_BYTES)
    return false;
  const actual = await derivePassword(password, salt, iterations);
  let difference = actual.byteLength ^ expected.byteLength;
  for (let index = 0; index < actual.byteLength; index += 1) {
    difference |= actual[index] ^ expected[index];
  }
  return difference === 0;
}

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function normalizePhone(value: string): string {
  const trimmed = value.trim();
  const digits = trimmed.replace(/\D/gu, "");
  if (trimmed.startsWith("+")) return `+${digits}`;
  if (digits.startsWith("60")) return `+${digits}`;
  if (digits.startsWith("0")) return `+60${digits.slice(1)}`;
  return `+${digits}`;
}

export function parseCookies(header: string | null): Record<string, string> {
  if (!header) return {};
  return Object.fromEntries(
    header.split(";").map((part) => {
      const index = part.indexOf("=");
      if (index < 0) return [part.trim(), ""];
      return [
        part.slice(0, index).trim(),
        decodeURIComponent(part.slice(index + 1).trim()),
      ];
    }),
  );
}

export function isAcceptableCustomerPassword(value: string): boolean {
  return value.length >= 8 && value.length <= 128;
}

export function isStrongAdminPassword(value: string): boolean {
  return (
    value.length >= 12 &&
    value.length <= 128 &&
    /[A-Za-z]/u.test(value) &&
    /\d/u.test(value)
  );
}

export const passwordHashParameters = {
  algorithm: "PBKDF2-HMAC-SHA256",
  iterations: PBKDF2_ITERATIONS,
  outputBytes: PBKDF2_BYTES,
} as const;
