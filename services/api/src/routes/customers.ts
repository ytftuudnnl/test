import { Router } from "express";
import { getDataRepository } from "../data";
import { asyncHandler } from "../utils/async-handler";
import { notFound } from "../utils/http-error";
import { sendData } from "../utils/response";
import { parsePage, readObject, readRouteParam, readString, readStringArray } from "../utils/validation";

export const customersRouter = Router();

customersRouter.get("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const { page, pageSize } = parsePage(req);
  const q = String(req.query.q || "").trim().toLowerCase();

  const list = await repo.listCustomers({ page, pageSize, q });
  sendData(req, res, list);
}));

customersRouter.post("/", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customer = await repo.createCustomer({
    name: readString(req.body?.name, "name", false) || undefined,
    email: readString(req.body?.email, "email", false) || undefined,
    phone: readString(req.body?.phone, "phone", false) || undefined,
    tags: readStringArray(req.body?.tags, "tags"),
    segments: readStringArray(req.body?.segments, "segments"),
    profile: readObject(req.body?.profile, "profile"),
  });

  sendData(req, res, customer, 201);
}));

customersRouter.get("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customerId = readRouteParam(req.params.id, "id");
  const customer = await repo.getCustomerById(customerId);
  if (!customer) throw notFound("Customer not found", { customerId });
  sendData(req, res, customer);
}));

customersRouter.put("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customerId = readRouteParam(req.params.id, "id");
  const patch: Record<string, unknown> = {};
  if (req.body?.name !== undefined) patch.name = readString(req.body?.name, "name", false) || undefined;
  if (req.body?.email !== undefined) patch.email = readString(req.body?.email, "email", false) || undefined;
  if (req.body?.phone !== undefined) patch.phone = readString(req.body?.phone, "phone", false) || undefined;
  if (req.body?.tags !== undefined) patch.tags = readStringArray(req.body?.tags, "tags");
  if (req.body?.segments !== undefined) patch.segments = readStringArray(req.body?.segments, "segments");
  if (req.body?.profile !== undefined) patch.profile = readObject(req.body?.profile, "profile");

  const customer = await repo.updateCustomer(customerId, patch);

  if (!customer) throw notFound("Customer not found", { customerId });
  sendData(req, res, customer);
}));

customersRouter.delete("/:id", asyncHandler(async (req, res) => {
  const repo = getDataRepository();
  const customerId = readRouteParam(req.params.id, "id");
  const ok = await repo.deleteCustomer(customerId);
  if (!ok) throw notFound("Customer not found", { customerId });
  sendData(req, res, { success: true });
}));
