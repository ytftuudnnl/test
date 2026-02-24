import { Router } from "express";
import { getDataRepository } from "../data";
import { asyncHandler } from "../utils/async-handler";
import { sendData } from "../utils/response";
import { badRequest, unauthorized } from "../utils/http-error";
import { readString } from "../utils/validation";

export const authRouter = Router();

authRouter.post("/login", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const username = readString(req.body?.username, "username");
  const password = readString(req.body?.password, "password");
  const user = await repo.findUserByCredentials(username, password);
  if (!user) throw unauthorized("Invalid username or password");

  sendData(req, res, {
    token: `access-${user.id}-${Date.now()}`,
    refreshToken: `refresh-${user.id}-${Date.now()}`,
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

  const user = await repo.createUser({
    username,
    email,
    passwordHash: password,
    role: "agent",
  });

  sendData(req, res, { userId: user.id }, 201);
}));

authRouter.post("/refresh", asyncHandler(async (req, res) => {
  const refreshToken = readString(req.body?.refreshToken, "refreshToken");
  if (!refreshToken.startsWith("refresh-")) {
    throw unauthorized("Invalid refresh token");
  }
  sendData(req, res, { token: `access-refreshed-${Date.now()}` });
}));
