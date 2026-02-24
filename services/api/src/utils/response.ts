import { Request, Response } from "express";
import { getTraceId } from "../middleware/trace";

export function sendData<T>(req: Request, res: Response, data: T, status = 200): void {
  res.status(status).json({
    data,
    traceId: getTraceId(req),
  });
}
