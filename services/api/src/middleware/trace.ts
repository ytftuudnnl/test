import { randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";

export const TRACE_HEADER = "x-trace-id";

export function traceMiddleware(req: Request, res: Response, next: NextFunction): void {
  const traceId = String(req.header(TRACE_HEADER) || randomUUID());
  req.headers[TRACE_HEADER] = traceId;
  res.setHeader(TRACE_HEADER, traceId);
  next();
}

export function getTraceId(req: Request): string {
  return String(req.header(TRACE_HEADER) || "unknown-trace");
}
