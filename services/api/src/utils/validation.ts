import { Request } from "express";
import { badRequest } from "./http-error";

export function readString(input: unknown, field: string, required = true): string {
  if (typeof input === "string") {
    const v = input.trim();
    if (v.length > 0) return v;
  }
  if (required) throw badRequest(`Field '${field}' is required`, { field });
  return "";
}

export function readStringArray(input: unknown, field: string): string[] {
  if (input === undefined || input === null) return [];
  if (!Array.isArray(input)) throw badRequest(`Field '${field}' must be an array`, { field });
  const values = input.filter((v) => typeof v === "string").map((v) => String(v).trim()).filter(Boolean);
  return Array.from(new Set(values));
}

export function readObject(input: unknown, field: string): Record<string, unknown> {
  if (input === undefined || input === null) return {};
  if (typeof input !== "object" || Array.isArray(input)) {
    throw badRequest(`Field '${field}' must be an object`, { field });
  }
  return input as Record<string, unknown>;
}

export function readBoolean(input: unknown, field: string): boolean {
  if (typeof input === "boolean") return input;
  if (input === "true") return true;
  if (input === "false") return false;
  throw badRequest(`Field '${field}' must be a boolean`, { field });
}

export function parsePage(req: Request): { page: number; pageSize: number } {
  const p = Number(req.query.page ?? 1);
  const ps = Number(req.query.pageSize ?? 20);
  if (!Number.isInteger(p) || p < 1) throw badRequest("Query 'page' must be an integer >= 1", { page: req.query.page });
  if (!Number.isInteger(ps) || ps < 1 || ps > 200) {
    throw badRequest("Query 'pageSize' must be an integer between 1 and 200", { pageSize: req.query.pageSize });
  }
  return { page: p, pageSize: ps };
}

export function readRouteParam(input: string | string[] | undefined, field: string): string {
  if (Array.isArray(input)) {
    if (input.length === 0) throw badRequest(`Route param '${field}' is required`, { field });
    return readString(input[0], field);
  }
  return readString(input, field);
}
