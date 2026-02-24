import { Router } from "express";
import { getDataRepository } from "../data";
import { asyncHandler } from "../utils/async-handler";
import { notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { readRouteParam } from "../utils/validation";

export const integrationsRouter = Router();

integrationsRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const integrations = await repo.listIntegrations();
  sendData(req, res, integrations);
}));

integrationsRouter.post("/:id/sync", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const integrationId = readRouteParam(req.params.id, "id");
  const integration = await repo.syncIntegration(integrationId);
  if (!integration) throw notFound("Integration not found", { integrationId });
  sendData(req, res, integration);
}));
