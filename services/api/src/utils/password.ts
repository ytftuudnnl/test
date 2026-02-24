import { randomBytes, scryptSync, timingSafeEqual } from "crypto";

const SCHEME = "scrypt";
const SALT_LENGTH = 16;
const KEY_LENGTH = 64;

function safeEquals(left: string, right: string): boolean {
  const leftBuf = Buffer.from(left, "utf8");
  const rightBuf = Buffer.from(right, "utf8");
  if (leftBuf.length !== rightBuf.length) return false;
  return timingSafeEqual(leftBuf, rightBuf);
}

export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_LENGTH);
  const hash = scryptSync(password, salt, KEY_LENGTH);
  return `${SCHEME}$${salt.toString("base64url")}$${hash.toString("base64url")}`;
}

export function verifyPassword(password: string, storedValue: string): boolean {
  if (!storedValue) return false;

  const parts = storedValue.split("$");
  if (parts.length === 3 && parts[0] === SCHEME) {
    try {
      const salt = Buffer.from(parts[1], "base64url");
      const storedHash = Buffer.from(parts[2], "base64url");
      const computed = scryptSync(password, salt, storedHash.length);
      if (computed.length !== storedHash.length) return false;
      return timingSafeEqual(computed, storedHash);
    } catch {
      return false;
    }
  }

  // Legacy compatibility for early plain-value seeded users.
  return safeEquals(password, storedValue);
}
