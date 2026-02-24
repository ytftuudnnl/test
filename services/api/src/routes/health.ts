import { Router } from "express";
import { getTraceId } from "../middleware/trace";
import { getDataDriver } from "../data";

export const healthRouter = Router();

healthRouter.get("/health", (req, res) => {
  res.json({
    data: {
      status: "ok",
      service: "cbsp-api",
      dataDriver: getDataDriver(),
      timestamp: new Date().toISOString(),
    },
    traceId: getTraceId(req),
  });
});
