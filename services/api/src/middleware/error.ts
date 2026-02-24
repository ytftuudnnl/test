import { Request, Response, NextFunction } from "express";
import { ApiError } from "../types";
import { getTraceId } from "./trace";
import { HttpError } from "../utils/http-error";

export function notFoundHandler(req: Request, res: Response): void {
  const payload: ApiError = {
    code: "RESOURCE_NOT_FOUND",
    message: `Route not found: ${req.method} ${req.path}`,
    traceId: getTraceId(req),
  };
  res.status(404).json(payload);
}

export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    const payload: ApiError = {
      code: err.code,
      message: err.message,
      traceId: getTraceId(req),
      details: err.details,
    };
    res.status(err.status).json(payload);
    return;
  }

  const payload: ApiError = {
    code: "INTERNAL_ERROR",
    message: "Unexpected server error",
    traceId: getTraceId(req),
    details: err instanceof Error ? { name: err.name, message: err.message } : undefined,
  };
  res.status(500).json(payload);
}
