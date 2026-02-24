import { Router } from "express";
import { getDataRepository } from "../data";
import { AutomationType } from "../data/types";
import { asyncHandler } from "../utils/async-handler";
import { badRequest, notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { parsePage, readBoolean, readObject, readRouteParam, readString } from "../utils/validation";

export const automationsRouter = Router();

function parseAutomationType(input: unknown): AutomationType {
  const value = readString(input, "type");
  if (value !== "message" && value !== "campaign" && value !== "workflow") {
    throw badRequest("Field 'type' must be message, campaign, or workflow", { type: value });
  }
  return value;
}

function readActions(input: unknown, field: string, required = true): Array<Record<string, unknown>> {
  if (input === undefined || input === null) {
    if (!required) return [];
    throw badRequest(`Field '${field}' is required`, { field });
  }
  if (!Array.isArray(input)) throw badRequest(`Field '${field}' must be an array`, { field });
  return input.map((item, index) => readObject(item, `${field}[${index}]`));
}

automationsRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const { page, pageSize } = parsePage(req);
  const enabled = String(req.query.enabled || "").trim().toLowerCase();
  const type = String(req.query.type || "").trim();

  if (enabled && enabled !== "true" && enabled !== "false") {
    throw badRequest("Query 'enabled' must be true or false", { enabled: req.query.enabled });
  }

  const list = await repo.listAutomations({
    page,
    pageSize,
    enabled: enabled || undefined,
    type: type ? parseAutomationType(type) : undefined,
  });

  sendData(req, res, list);
}));

automationsRouter.post("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const automation = await repo.createAutomation({
    name: readString(req.body?.name, "name"),
    type: parseAutomationType(req.body?.type),
    trigger: readObject(req.body?.trigger, "trigger"),
    actions: readActions(req.body?.actions, "actions"),
    enabled: req.body?.enabled !== undefined ? readBoolean(req.body?.enabled, "enabled") : true,
  });

  sendData(req, res, automation, 201);
}));

automationsRouter.get("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const automationId = readRouteParam(req.params.id, "id");
  const automation = await repo.getAutomationById(automationId);
  if (!automation) throw notFound("Automation not found", { automationId });
  sendData(req, res, automation);
}));

automationsRouter.put("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const automationId = readRouteParam(req.params.id, "id");
  const patch: Record<string, unknown> = {};

  if (req.body?.name !== undefined) patch.name = readString(req.body?.name, "name");
  if (req.body?.type !== undefined) patch.type = parseAutomationType(req.body?.type);
  if (req.body?.trigger !== undefined) patch.trigger = readObject(req.body?.trigger, "trigger");
  if (req.body?.actions !== undefined) patch.actions = readActions(req.body?.actions, "actions", false);
  if (req.body?.enabled !== undefined) patch.enabled = readBoolean(req.body?.enabled, "enabled");

  const automation = await repo.updateAutomation(automationId, patch);
  if (!automation) throw notFound("Automation not found", { automationId });
  sendData(req, res, automation);
}));

automationsRouter.delete("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const automationId = readRouteParam(req.params.id, "id");
  const ok = await repo.deleteAutomation(automationId);
  if (!ok) throw notFound("Automation not found", { automationId });
  sendData(req, res, { success: true });
}));
