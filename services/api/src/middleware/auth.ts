import { NextFunction, Request, Response } from "express";
import { UserRole } from "../data/types";
import { forbidden, unauthorized } from "../utils/http-error";
import { verifyAccessToken } from "../utils/tokens";

export interface AuthContext {
  userId: string;
  role: UserRole;
  sessionId: string;
}

function readBearerToken(req: Request): string {
  const raw = req.headers.authorization;
  if (!raw) throw unauthorized("Missing authorization header");
  const [scheme, token] = raw.split(" ");
  if (!scheme || !token || scheme.toLowerCase() !== "bearer") {
    throw unauthorized("Invalid authorization header");
  }
  return token.trim();
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  try {
    const token = readBearerToken(req);
    const claims = verifyAccessToken(token);
    res.locals.auth = {
      userId: claims.sub,
      role: claims.role,
      sessionId: claims.sid,
    } satisfies AuthContext;
    next();
  } catch {
    next(unauthorized("Invalid or expired access token"));
  }
}

export function requireRoles(roles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const auth = res.locals.auth as AuthContext | undefined;
    if (!auth) {
      next(unauthorized("Missing authenticated context"));
      return;
    }
    if (!roles.includes(auth.role)) {
      next(forbidden("Insufficient role for this action"));
      return;
    }
    next();
  };
}
