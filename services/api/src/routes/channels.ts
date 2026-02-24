import { Router } from "express";
import { getDataRepository } from "../data";
import { ChannelStatus } from "../data/types";
import { asyncHandler } from "../utils/async-handler";
import { badRequest, notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { readObject, readRouteParam, readString } from "../utils/validation";

export const channelsRouter = Router();

function parseChannelStatus(input: unknown): ChannelStatus {
  const value = readString(input, "status");
  if (value !== "connected" && value !== "disconnected" && value !== "error") {
    throw badRequest("Field 'status' must be connected, disconnected, or error", { status: value });
  }
  return value;
}

channelsRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channels = await repo.listChannels();
  sendData(req, res, channels);
}));

channelsRouter.post("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channel = await repo.createChannel({
    type: readString(req.body?.type, "type"),
    config: readObject(req.body?.config, "config"),
  });
  sendData(req, res, channel, 201);
}));

channelsRouter.get("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channelId = readRouteParam(req.params.id, "id");
  const channel = await repo.getChannelById(channelId);
  if (!channel) throw notFound("Channel not found", { channelId });
  sendData(req, res, channel);
}));

channelsRouter.put("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channelId = readRouteParam(req.params.id, "id");
  const patch: Record<string, unknown> = {};

  if (req.body?.type !== undefined) patch.type = readString(req.body?.type, "type");
  if (req.body?.config !== undefined) patch.config = readObject(req.body?.config, "config");
  if (req.body?.status !== undefined) patch.status = parseChannelStatus(req.body?.status);

  const channel = await repo.updateChannel(channelId, patch);
  if (!channel) throw notFound("Channel not found", { channelId });
  sendData(req, res, channel);
}));

channelsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channelId = readRouteParam(req.params.id, "id");
  const ok = await repo.deleteChannel(channelId);
  if (!ok) throw notFound("Channel not found", { channelId });
  sendData(req, res, { success: true });
}));

channelsRouter.post("/:id/test", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const channelId = readRouteParam(req.params.id, "id");
  const channel = await repo.testChannel(channelId);
  if (!channel) throw notFound("Channel not found", { channelId });
  sendData(req, res, channel);
}));
