import { Router } from "express";
import { randomUUID } from "crypto";
import { getDataRepository } from "../data";
import { asyncHandler } from "../utils/async-handler";
import { sendData } from "../utils/response";
import { badRequest, unauthorized } from "../utils/http-error";
import { readString } from "../utils/validation";
import { hashPassword } from "../utils/password";
import { issueAccessToken, issueRefreshToken, TokenClaims, verifyRefreshToken } from "../utils/tokens";
import { UserRole } from "../data/types";

export const authRouter = Router();

interface RefreshSessionState {
  userId: string;
  role: UserRole;
  sessionId: string;
  expiresAtEpochSec: number;
}

const refreshSessions = new Map<string, RefreshSessionState>();

function pruneRefreshSessions(): void {
  const now = Math.floor(Date.now() / 1000);
  for (const [jti, session] of refreshSessions.entries()) {
    if (session.expiresAtEpochSec <= now) {
      refreshSessions.delete(jti);
    }
  }
}

authRouter.post("/login", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const username = readString(req.body?.username, "username");
  const password = readString(req.body?.password, "password");
  const user = await repo.findUserByCredentials(username, password);
  if (!user) throw unauthorized("Invalid username or password");

  pruneRefreshSessions();
  const sessionId = randomUUID();
  const access = issueAccessToken({ userId: user.id, role: user.role, sessionId });
  const refresh = issueRefreshToken({ userId: user.id, role: user.role, sessionId });
  refreshSessions.set(refresh.jti, {
    userId: user.id,
    role: user.role,
    sessionId,
    expiresAtEpochSec: refresh.expiresAtEpochSec,
  });

  sendData(req, res, {
    token: access.token,
    refreshToken: refresh.token,
    tokenExpiresAt: new Date(access.expiresAtEpochSec * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(refresh.expiresAtEpochSec * 1000).toISOString(),
    user: {
      id: user.id,
      username: user.username,
      role: user.role,
      email: user.email,
    },
  });
}));

authRouter.post("/register", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const username = readString(req.body?.username, "username");
  const email = readString(req.body?.email, "email");
  const password = readString(req.body?.password, "password");

  const duplicated = await repo.existsUserByUsernameOrEmail(username, email);
  if (duplicated) throw badRequest("Username or email already exists", { username, email });
  const passwordHash = hashPassword(password);

  const user = await repo.createUser({
    username,
    email,
    passwordHash,
    role: "agent",
  });

  sendData(req, res, { userId: user.id }, 201);
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = readString(req.body?.refreshToken, "refreshToken");

  pruneRefreshSessions();

  let claims: TokenClaims;
  try {
    claims = verifyRefreshToken(refreshToken);
  } catch {
    throw unauthorized("Invalid refresh token");
  }

  const session = refreshSessions.get(claims.jti);
  if (!session) {
    throw unauthorized("Refresh token is no longer valid");
  }
  if (session.userId !== claims.sub || session.sessionId !== claims.sid) {
    refreshSessions.delete(claims.jti);
    throw unauthorized("Refresh token session mismatch");
  }

  refreshSessions.delete(claims.jti);

  const access = issueAccessToken({ userId: session.userId, role: session.role, sessionId: session.sessionId });
  const refresh = issueRefreshToken({ userId: session.userId, role: session.role, sessionId: session.sessionId });
  refreshSessions.set(refresh.jti, {
    userId: session.userId,
    role: session.role,
    sessionId: session.sessionId,
    expiresAtEpochSec: refresh.expiresAtEpochSec,
  });

  sendData(req, res, {
    token: access.token,
    refreshToken: refresh.token,
    tokenExpiresAt: new Date(access.expiresAtEpochSec * 1000).toISOString(),
    refreshTokenExpiresAt: new Date(refresh.expiresAtEpochSec * 1000).toISOString(),
  });
}));
