import { Router } from "express";
import { getDataRepository } from "../data";
import { ConversationStatus } from "../data/types";
import { asyncHandler } from "../utils/async-handler";
import { badRequest, notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { parsePage, readRouteParam, readString } from "../utils/validation";

export const conversationsRouter = Router();

function parseConversationStatus(input: unknown): ConversationStatus {
  const value = readString(input, "status");
  if (value !== "open" && value !== "closed" && value !== "pending") {
    throw badRequest("Field 'status' must be open, closed, or pending", { status: value });
  }
  return value;
}

conversationsRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const { page, pageSize } = parsePage(req);
  const customerId = String(req.query.customerId || "").trim();
  const channel = String(req.query.channel || "").trim();
  const status = String(req.query.status || "").trim();

  const list = await repo.listConversations({
    page,
    pageSize,
    customerId: customerId || undefined,
    channel: channel || undefined,
    status: status ? parseConversationStatus(status) : undefined,
  });

  sendData(req, res, list);
}));

conversationsRouter.post("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customerId = readString(req.body?.customerId, "customerId");
  const customer = await repo.getCustomerById(customerId);
  if (!customer) throw notFound("Customer not found", { customerId });

  const conversation = await repo.createConversation({
    customerId,
    channel: readString(req.body?.channel, "channel"),
    channelId: readString(req.body?.channelId, "channelId", false) || undefined,
    status: req.body?.status !== undefined ? parseConversationStatus(req.body?.status) : "open",
  });
  sendData(req, res, conversation, 201);
}));

conversationsRouter.get("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const conversationId = readRouteParam(req.params.id, "id");
  const conversation = await repo.getConversationById(conversationId);
  if (!conversation) throw notFound("Conversation not found", { conversationId });
  sendData(req, res, conversation);
}));

conversationsRouter.put("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const conversationId = readRouteParam(req.params.id, "id");
  const patch: Record<string, unknown> = {};

  if (req.body?.customerId !== undefined) {
    const customerId = readString(req.body?.customerId, "customerId");
    const customer = await repo.getCustomerById(customerId);
    if (!customer) throw notFound("Customer not found", { customerId });
    patch.customerId = customerId;
  }
  if (req.body?.channel !== undefined) patch.channel = readString(req.body?.channel, "channel");
  if (req.body?.channelId !== undefined) {
    patch.channelId = readString(req.body?.channelId, "channelId", false) || undefined;
  }
  if (req.body?.status !== undefined) patch.status = parseConversationStatus(req.body?.status);

  const conversation = await repo.updateConversation(conversationId, patch);
  if (!conversation) throw notFound("Conversation not found", { conversationId });
  sendData(req, res, conversation);
}));

conversationsRouter.get("/:id/messages", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const conversationId = readRouteParam(req.params.id, "id");
  const conversation = await repo.getConversationById(conversationId);
  if (!conversation) throw notFound("Conversation not found", { conversationId });

  const messages = await repo.listMessagesByConversationId(conversationId);
  sendData(req, res, messages);
}));
