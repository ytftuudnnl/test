import express from "express";
import cors from "cors";
import { traceMiddleware } from "./middleware/trace";
import { errorHandler, notFoundHandler } from "./middleware/error";
import { healthRouter } from "./routes/health";
import { authRouter } from "./routes/auth";
import { customersRouter } from "./routes/customers";
import { messagesRouter } from "./routes/messages";
import { conversationsRouter } from "./routes/conversations";
import { channelsRouter } from "./routes/channels";
import { automationsRouter } from "./routes/automations";
import { analyticsRouter } from "./routes/analytics";
import { integrationsRouter } from "./routes/integrations";

export function createApp() {
  const app = express();

  app.use(cors());
  app.use(express.json());
  app.use(traceMiddleware);

  app.use(healthRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/customers", customersRouter);
  app.use("/api/messages", messagesRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/channels", channelsRouter);
  app.use("/api/automations", automationsRouter);
  app.use("/api/analytics", analyticsRouter);
  app.use("/api/integrations", integrationsRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
