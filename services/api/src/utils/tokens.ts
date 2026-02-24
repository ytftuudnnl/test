import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { UserRole } from "../data/types";

type TokenType = "access" | "refresh";

export interface TokenClaims {
  sub: string;
  role: UserRole;
  sid: string;
  jti: string;
  typ: TokenType;
  iat: number;
  exp: number;
}

interface IssueAccessTokenInput {
  userId: string;
  role: UserRole;
  sessionId: string;
}

interface IssueRefreshTokenInput {
  userId: string;
  role: UserRole;
  sessionId: string;
}

export interface IssuedRefreshToken {
  token: string;
  jti: string;
  sessionId: string;
  expiresAtEpochSec: number;
}

const ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET?.trim() || "cbsp-dev-access-secret-change-me";
const REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET?.trim() || "cbsp-dev-refresh-secret-change-me";

const ACCESS_TTL_SECONDS = normalizeTtl(process.env.AUTH_ACCESS_TTL_SECONDS, 15 * 60);
const REFRESH_TTL_SECONDS = normalizeTtl(process.env.AUTH_REFRESH_TTL_SECONDS, 7 * 24 * 60 * 60);

function normalizeTtl(input: string | undefined, fallback: number): number {
  const parsed = Number(input);
  if (!Number.isFinite(parsed) || parsed <= 0) return fallback;
  return Math.floor(parsed);
}

function encodeJson(value: unknown): string {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeJson<T>(value: string): T {
  const text = Buffer.from(value, "base64url").toString("utf8");
  return JSON.parse(text) as T;
}

function signRaw(secret: string, raw: string): string {
  return createHmac("sha256", secret).update(raw).digest("base64url");
}

function signToken(claims: TokenClaims, secret: string): string {
  const header = encodeJson({ alg: "HS256", typ: "JWT" });
  const payload = encodeJson(claims);
  const signingInput = `${header}.${payload}`;
  const signature = signRaw(secret, signingInput);
  return `${signingInput}.${signature}`;
}

function parseAndVerify(token: string, secret: string, expectedType: TokenType): TokenClaims {
  const parts = token.split(".");
  if (parts.length !== 3) throw new Error("Malformed token");

  const [headerPart, payloadPart, signaturePart] = parts;
  const signingInput = `${headerPart}.${payloadPart}`;
  const expectedSignature = signRaw(secret, signingInput);

  const actualSig = Buffer.from(signaturePart, "utf8");
  const expectedSig = Buffer.from(expectedSignature, "utf8");
  if (actualSig.length !== expectedSig.length || !timingSafeEqual(actualSig, expectedSig)) {
    throw new Error("Invalid token signature");
  }

  const claims = decodeJson<TokenClaims>(payloadPart);
  if (claims.typ !== expectedType) throw new Error("Invalid token type");

  const now = Math.floor(Date.now() / 1000);
  if (!Number.isFinite(claims.exp) || claims.exp <= now) throw new Error("Token expired");
  if (!claims.sub || !claims.jti || !claims.sid) throw new Error("Invalid token payload");

  return claims;
}

export function issueAccessToken(input: IssueAccessTokenInput): { token: string; expiresAtEpochSec: number } {
  const now = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = {
    sub: input.userId,
    role: input.role,
    sid: input.sessionId,
    jti: randomUUID(),
    typ: "access",
    iat: now,
    exp: now + ACCESS_TTL_SECONDS,
  };
  return {
    token: signToken(claims, ACCESS_SECRET),
    expiresAtEpochSec: claims.exp,
  };
}

export function issueRefreshToken(input: IssueRefreshTokenInput): IssuedRefreshToken {
  const now = Math.floor(Date.now() / 1000);
  const claims: TokenClaims = {
    sub: input.userId,
    role: input.role,
    sid: input.sessionId,
    jti: randomUUID(),
    typ: "refresh",
    iat: now,
    exp: now + REFRESH_TTL_SECONDS,
  };
  return {
    token: signToken(claims, REFRESH_SECRET),
    jti: claims.jti,
    sessionId: claims.sid,
    expiresAtEpochSec: claims.exp,
  };
}

export function verifyRefreshToken(token: string): TokenClaims {
  return parseAndVerify(token, REFRESH_SECRET, "refresh");
}

export function verifyAccessToken(token: string): TokenClaims {
  return parseAndVerify(token, ACCESS_SECRET, "access");
}
