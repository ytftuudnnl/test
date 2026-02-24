#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ensureMongoAvailability } = require("./lib/mongo-local-runner");

function parseArgs(argv) {
  const parsed = {
    driver: "memory",
    requireMongo: false,
    port: 0,
    out: "",
    mongoAutostart: true,
  };

  for (const arg of argv) {
    if (arg.startsWith("--driver=")) {
      const value = arg.slice("--driver=".length).trim().toLowerCase();
      if (value !== "memory" && value !== "mongo") {
        throw new Error(`Invalid --driver value: ${value}`);
      }
      parsed.driver = value;
      continue;
    }
    if (arg === "--require-mongo") {
      parsed.requireMongo = true;
      continue;
    }
    if (arg.startsWith("--port=")) {
      const value = Number(arg.slice("--port=".length));
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(`Invalid --port value: ${arg.slice("--port=".length)}`);
      }
      parsed.port = value;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length).trim();
      continue;
    }
    if (arg.startsWith("--mongo-autostart=")) {
      const value = arg.slice("--mongo-autostart=".length).trim().toLowerCase();
      if (value === "on" || value === "true" || value === "1") {
        parsed.mongoAutostart = true;
      } else if (value === "off" || value === "false" || value === "0") {
        parsed.mongoAutostart = false;
      } else {
        throw new Error(`Invalid --mongo-autostart value: ${value}`);
      }
      continue;
    }
  }

  return parsed;
}

function makeEvidencePath(driver, explicitOut) {
  if (explicitOut) return explicitOut;
  const now = new Date();
  const stamp = now.toISOString().slice(0, 10);
  return path.resolve(__dirname, "../qa-evidence", `qa-e2e-${driver}-${stamp}.json`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseMongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const mongoDb = process.env.MONGODB_DB || `cbsp_qa_e2e_${Date.now()}`;
  const outPath = makeEvidencePath(options.driver, options.out);
  const workdir = path.resolve(__dirname, "..");
  let mongoRuntime = null;

  if (options.driver === "mongo") {
    mongoRuntime = await ensureMongoAvailability({
      mongoUri: baseMongoUri,
      requireMongo: options.requireMongo,
      workdir,
      autoStart: options.mongoAutostart,
    });
  }

  process.env.DATA_DRIVER = options.driver;
  process.env.PORT = String(options.port);
  if (options.driver === "mongo") {
    process.env.MONGODB_URI = mongoRuntime ? mongoRuntime.uri : baseMongoUri;
    process.env.MONGODB_DB = mongoDb;
  } else {
    delete process.env.MONGODB_URI;
    delete process.env.MONGODB_DB;
  }

  const data = require("../services/api/dist/data");
  const { createApp } = require("../services/api/dist/app");

  await data.initDataRepository();
  const app = createApp();
  const server = await new Promise((resolve) => {
    const s = app.listen(options.port, () => resolve(s));
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Failed to bind API server");
  }
  const base = `http://127.0.0.1:${address.port}`;
  const idSuffix = Date.now();

  async function request(method, route, body, expectedStatus = 200, token = "") {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(`${base}${route}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    const text = await response.text();
    let payload = {};
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = { raw: text };
      }
    }

    if (response.status !== expectedStatus) {
      throw new Error(
        `Unexpected status for ${method} ${route}: expected ${expectedStatus}, got ${response.status}, body=${text}`,
      );
    }

    return payload;
  }

  const evidence = {
    ok: false,
    date: new Date().toISOString(),
    driver: options.driver,
    base,
    checks: {
      health: null,
      agentForbidden: null,
      coreFlow: null,
      adminFlow: null,
    },
    traceIds: [],
    ids: {},
  };

  try {
    const health = await request("GET", "/health", undefined, 200);
    assert.ok(health.data && health.data.status === "ok", "health status must be ok");
    if (options.driver === "memory") {
      assert.equal(health.data.dataDriver, "memory", "memory run must use memory driver");
    }
    if (options.driver === "mongo" && options.requireMongo) {
      assert.equal(health.data.dataDriver, "mongo", "mongo run must use mongo driver");
    }
    evidence.checks.health = {
      pass: true,
      dataDriver: health.data.dataDriver,
      timestamp: health.data.timestamp,
    };

    const agentLogin = await request("POST", "/api/auth/login", {
      username: "agent.demo",
      password: "pass-1234",
    });
    const agentToken = agentLogin.data.token;
    assert.ok(agentToken, "agent login token missing");

    const forbiddenResp = await request("GET", "/api/integrations", undefined, 403, agentToken);
    evidence.checks.agentForbidden = {
      pass: forbiddenResp.code === "AUTH_FORBIDDEN",
      code: forbiddenResp.code,
      traceId: forbiddenResp.traceId || null,
      endpoint: "/api/integrations",
    };
    if (forbiddenResp.traceId) evidence.traceIds.push(forbiddenResp.traceId);

    const customer = await request(
      "POST",
      "/api/customers",
      {
        name: `QA User ${idSuffix}`,
        email: `qa.${idSuffix}@example.com`,
        tags: ["qa-e2e"],
        segments: ["smoke"],
        profile: { source: "qa-e2e" },
      },
      201,
      agentToken,
    );
    const customerId = customer.data.id;
    assert.ok(customerId, "customer id missing");

    const conversation = await request(
      "POST",
      "/api/conversations",
      {
        customerId,
        channel: "email",
        status: "open",
      },
      201,
      agentToken,
    );
    const conversationId = conversation.data.id;
    assert.ok(conversationId, "conversation id missing");

    const inboundMessage = await request(
      "POST",
      "/api/messages",
      {
        customerId,
        channel: "email",
        direction: "inbound",
        content: "Where is my package?",
        status: "pending",
      },
      201,
      agentToken,
    );
    const inboundMessageId = inboundMessage.data.id;
    assert.ok(inboundMessageId, "inbound message id missing");

    const translatedInbound = await request(
      "PUT",
      `/api/messages/${inboundMessageId}`,
      {
        status: "processed",
        translatedContent: "Where is my package?",
      },
      200,
      agentToken,
    );
    assert.equal(translatedInbound.data.status, "processed", "inbound message should be processed");

    const outboundMessage = await request(
      "POST",
      "/api/messages",
      {
        customerId,
        channel: "email",
        direction: "outbound",
        content: "Your order has shipped and is in transit.",
        status: "delivered",
      },
      201,
      agentToken,
    );
    const outboundMessageId = outboundMessage.data.id;
    assert.ok(outboundMessageId, "outbound message id missing");

    const customerMessages = await request(
      "GET",
      `/api/messages?page=1&pageSize=50&customerId=${encodeURIComponent(customerId)}`,
      undefined,
      200,
      agentToken,
    );
    const convoItems = customerMessages && customerMessages.data && Array.isArray(customerMessages.data.items)
      ? customerMessages.data.items
      : [];
    assert.ok(
      convoItems.some((item) => item.id === inboundMessageId) &&
      convoItems.some((item) => item.id === outboundMessageId),
      "conversation messages missing inbound/outbound entries",
    );

    evidence.ids.customerId = customerId;
    evidence.ids.conversationId = conversationId;
    evidence.ids.inboundMessageId = inboundMessageId;
    evidence.ids.outboundMessageId = outboundMessageId;
    evidence.checks.coreFlow = {
      pass: true,
      path: "inbound -> process/translate -> outbound (customer scoped)",
      customerMessages: convoItems.length,
    };

    const adminLogin = await request("POST", "/api/auth/login", {
      username: "admin.demo",
      password: "pass-1234",
    });
    const adminToken = adminLogin.data.token;
    assert.ok(adminToken, "admin login token missing");

    const integrations = await request("GET", "/api/integrations", undefined, 200, adminToken);
    const integrationItems = Array.isArray(integrations.data) ? integrations.data : [];
    assert.ok(integrationItems.length > 0, "admin integrations should not be empty");

    const rehearsalChannel = await request(
      "POST",
      "/api/channels",
      {
        type: "qa-rehearsal",
        config: {
          scenario: "admin-destructive-rehearsal",
          reason: "qa-e2e",
        },
      },
      201,
      adminToken,
    );
    const rehearsalChannelId = rehearsalChannel.data.id;
    assert.ok(rehearsalChannelId, "rehearsal channel id missing");

    const deletedRehearsal = await request(
      "DELETE",
      `/api/channels/${rehearsalChannelId}`,
      undefined,
      200,
      adminToken,
    );
    assert.equal(deletedRehearsal.data.success, true, "rehearsal channel must be deleted");

    evidence.ids.rehearsalChannelId = rehearsalChannelId;
    evidence.checks.adminFlow = {
      pass: true,
      integrationsCount: integrationItems.length,
      destructiveRehearsal: "create channel -> delete channel",
    };

    evidence.ok = true;

    const outputDir = path.dirname(outPath);
    fs.mkdirSync(outputDir, { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

    console.log(JSON.stringify({
      ok: true,
      out: outPath,
      driver: options.driver,
      base,
      mongoUri: options.driver === "mongo" ? process.env.MONGODB_URI : undefined,
      mongoRuntime: mongoRuntime ? mongoRuntime.details : undefined,
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await data.closeDataRepository();
    if (mongoRuntime) {
      await mongoRuntime.cleanup();
    }
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
