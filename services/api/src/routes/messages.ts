import { Router } from "express";
import { getDataRepository } from "../data";
import { MessageDirection, MessageStatus } from "../data/types";
import { asyncHandler } from "../utils/async-handler";
import { badRequest, notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { parsePage, readRouteParam, readString } from "../utils/validation";

export const messagesRouter = Router();

function parseDirection(input: unknown): MessageDirection {
  const value = readString(input, "direction");
  if (value !== "inbound" && value !== "outbound") {
    throw badRequest("Field 'direction' must be inbound or outbound", { direction: value });
  }
  return value;
}

function parseStatus(input: unknown): MessageStatus {
  const value = readString(input, "status");
  if (value !== "pending" && value !== "processed" && value !== "delivered") {
    throw badRequest("Field 'status' must be pending, processed, or delivered", { status: value });
  }
  return value;
}

messagesRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const { page, pageSize } = parsePage(req);
  const customerId = String(req.query.customerId || "").trim();
  const status = String(req.query.status || "").trim();
  const channel = String(req.query.channel || "").trim();

  const list = await repo.listMessages({
    page,
    pageSize,
    customerId: customerId || undefined,
    status: status || undefined,
    channel: channel || undefined,
  });

  sendData(req, res, list);
}));

messagesRouter.post("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customerId = readString(req.body?.customerId, "customerId");
  const customer = await repo.getCustomerById(customerId);
  if (!customer) throw notFound("Customer not found", { customerId });

  const message = await repo.createMessage({
    customerId,
    channel: readString(req.body?.channel, "channel"),
    channelId: readString(req.body?.channelId, "channelId", false) || undefined,
    direction: parseDirection(req.body?.direction),
    content: readString(req.body?.content, "content"),
    translatedContent: readString(req.body?.translatedContent, "translatedContent", false) || undefined,
    status: req.body?.status ? parseStatus(req.body?.status) : "pending",
    assignedTo: readString(req.body?.assignedTo, "assignedTo", false) || undefined,
  });

  sendData(req, res, message, 201);
}));

messagesRouter.get("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const messageId = readRouteParam(req.params.id, "id");
  const message = await repo.getMessageById(messageId);
  if (!message) throw notFound("Message not found", { messageId });
  sendData(req, res, message);
}));

messagesRouter.put("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const messageId = readRouteParam(req.params.id, "id");
  const patch: Record<string, unknown> = {};
  if (req.body?.status !== undefined) patch.status = parseStatus(req.body?.status);
  if (req.body?.assignedTo !== undefined) patch.assignedTo = readString(req.body?.assignedTo, "assignedTo", false) || undefined;
  if (req.body?.translatedContent !== undefined) {
    patch.translatedContent = readString(req.body?.translatedContent, "translatedContent", false) || undefined;
  }
  if (req.body?.content !== undefined) patch.content = readString(req.body?.content, "content");

  const message = await repo.updateMessage(messageId, patch);
  if (!message) throw notFound("Message not found", { messageId });
  sendData(req, res, message);
}));
