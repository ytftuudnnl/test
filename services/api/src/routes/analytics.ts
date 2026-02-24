import { Router } from "express";
import { getDataRepository } from "../data";
import { asyncHandler } from "../utils/async-handler";
import { badRequest } from "../utils/http-error";
import { sendData } from "../utils/response";

export const analyticsRouter = Router();

function parseDays(input: unknown): number {
  if (input === undefined || input === null || input === "") return 7;
  const days = Number(input);
  if (!Number.isInteger(days) || days < 1 || days > 90) {
    throw badRequest("Query 'days' must be an integer between 1 and 90", { days: input });
  }
  return days;
}

analyticsRouter.get("/summary", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const summary = await repo.getAnalyticsSummary();
  sendData(req, res, summary);
}));

analyticsRouter.get("/messages", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const days = parseDays(req.query.days);
  const daily = await repo.getAnalyticsMessageTrend(days);
  sendData(req, res, { daily });
}));
