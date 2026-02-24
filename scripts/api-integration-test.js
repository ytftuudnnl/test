#!/usr/bin/env node
const assert = require("node:assert/strict");

function parseArgs(argv) {
  const parsed = {
    driver: "memory",
    requireMongo: false,
    port: 0,
  };

  for (const arg of argv) {
    if (arg.startsWith("--driver=")) {
      const value = arg.slice("--driver=".length).trim().toLowerCase();
      if (value === "memory" || value === "mongo") {
        parsed.driver = value;
      } else {
        throw new Error(`Invalid --driver value: ${value}`);
      }
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
  }

  return parsed;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const mongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const mongoDb = process.env.MONGODB_DB || `cbsp_integration_${Date.now()}`;

  process.env.DATA_DRIVER = options.driver;
  process.env.PORT = String(options.port);
  if (options.driver === "mongo") {
    process.env.MONGODB_URI = mongoUri;
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

  async function api(method, path, body, expectedStatus = 200) {
    const headers = {};
    let payload = undefined;
    if (body !== undefined) {
      headers["content-type"] = "application/json";
      payload = JSON.stringify(body);
    }

    const response = await fetch(`${base}${path}`, {
      method,
      headers,
      body: payload,
    });
    const text = await response.text();
    let json = {};
    if (text) {
      try {
        json = JSON.parse(text);
      } catch (err) {
        throw new Error(`Invalid JSON response for ${method} ${path}: ${text}`);
      }
    }

    if (response.status !== expectedStatus) {
      throw new Error(
        `Unexpected status for ${method} ${path}: expected ${expectedStatus}, got ${response.status}, body=${text}`,
      );
    }
    return json;
  }

  try {
    const health = await api("GET", "/health");
    assert.ok(health.data && health.data.status === "ok", "health status must be ok");
    if (options.driver === "memory") {
      assert.equal(health.data.dataDriver, "memory", "memory test must run with memory driver");
    }
    if (options.driver === "mongo" && options.requireMongo) {
      assert.equal(health.data.dataDriver, "mongo", "mongo test requires mongo driver");
    }

    const login = await api("POST", "/api/auth/login", { username: "agent.demo", password: "pass-1234" });
    assert.ok(typeof login.data.token === "string" && login.data.token.length > 0, "login token missing");

    const createdCustomer = await api("POST", "/api/customers", {
      name: `Integration User ${idSuffix}`,
      email: `integration.${idSuffix}@example.com`,
      tags: ["integration"],
      segments: ["api-test"],
      profile: { source: "integration-test" },
    }, 201);
    const customerId = createdCustomer.data.id;
    assert.ok(customerId, "customer id missing");

    const fetchedCustomer = await api("GET", `/api/customers/${customerId}`);
    assert.equal(fetchedCustomer.data.id, customerId, "customer fetch mismatch");

    const updatedCustomer = await api("PUT", `/api/customers/${customerId}`, {
      phone: "+1-202-555-0199",
    });
    assert.equal(updatedCustomer.data.phone, "+1-202-555-0199", "customer update failed");

    const createdMessage = await api("POST", "/api/messages", {
      customerId,
      channel: "email",
      direction: "outbound",
      content: "Hello from integration test",
      status: "pending",
    }, 201);
    const messageId = createdMessage.data.id;
    assert.ok(messageId, "message id missing");

    const updatedMessage = await api("PUT", `/api/messages/${messageId}`, {
      status: "processed",
      translatedContent: "translated",
    });
    assert.equal(updatedMessage.data.status, "processed", "message status update failed");

    const listedMessages = await api("GET", `/api/messages?page=1&pageSize=50&customerId=${customerId}`);
    assert.ok(
      Array.isArray(listedMessages.data.items) && listedMessages.data.items.some((v) => v.id === messageId),
      "message list does not contain created message",
    );

    const createdConversation = await api("POST", "/api/conversations", {
      customerId,
      channel: "email",
      status: "open",
    }, 201);
    const conversationId = createdConversation.data.id;
    assert.ok(conversationId, "conversation id missing");

    const updatedConversation = await api("PUT", `/api/conversations/${conversationId}`, { status: "pending" });
    assert.equal(updatedConversation.data.status, "pending", "conversation status update failed");

    const conversationMessages = await api("GET", `/api/conversations/${conversationId}/messages`);
    assert.ok(Array.isArray(conversationMessages.data), "conversation messages must be array");

    const createdChannel = await api("POST", "/api/channels", {
      type: "line",
      config: { webhook: "https://example.com/line/webhook" },
    }, 201);
    const channelId = createdChannel.data.id;
    assert.ok(channelId, "channel id missing");

    const updatedChannel = await api("PUT", `/api/channels/${channelId}`, { status: "error" });
    assert.equal(updatedChannel.data.status, "error", "channel update failed");

    const testedChannel = await api("POST", `/api/channels/${channelId}/test`);
    assert.equal(testedChannel.data.status, "connected", "channel test should set connected");

    const deletedChannel = await api("DELETE", `/api/channels/${channelId}`);
    assert.equal(deletedChannel.data.success, true, "channel delete must return success=true");

    const createdRule = await api("POST", "/api/automations", {
      name: `Integration Rule ${idSuffix}`,
      type: "workflow",
      trigger: { event: "order.created" },
      actions: [{ type: "send_message", template: "welcome_template" }],
      enabled: true,
    }, 201);
    const ruleId = createdRule.data.id;
    assert.ok(ruleId, "automation rule id missing");

    const updatedRule = await api("PUT", `/api/automations/${ruleId}`, { enabled: false });
    assert.equal(updatedRule.data.enabled, false, "automation update failed");

    const deletedRule = await api("DELETE", `/api/automations/${ruleId}`);
    assert.equal(deletedRule.data.success, true, "automation delete must return success=true");

    const analyticsSummary = await api("GET", "/api/analytics/summary");
    assert.ok(analyticsSummary.data.totalMessages >= 1, "analytics summary totalMessages must be >= 1");

    const analyticsTrend = await api("GET", "/api/analytics/messages?days=3");
    assert.ok(Array.isArray(analyticsTrend.data.daily), "analytics trend daily must be array");
    assert.equal(analyticsTrend.data.daily.length, 3, "analytics trend days mismatch");

    const integrations = await api("GET", "/api/integrations");
    assert.ok(Array.isArray(integrations.data) && integrations.data.length > 0, "integrations must be non-empty");
    const integrationId = integrations.data[0].id;
    assert.ok(integrationId, "integration id missing");

    const syncedIntegration = await api("POST", `/api/integrations/${integrationId}/sync`);
    assert.equal(syncedIntegration.data.id, integrationId, "integration sync id mismatch");
    assert.equal(syncedIntegration.data.status, "synced", "integration sync status mismatch");

    console.log(JSON.stringify({
      ok: true,
      driver: health.data.dataDriver,
      base,
      mongoDb: options.driver === "mongo" ? mongoDb : undefined,
    }, null, 2));
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await data.closeDataRepository();
  }
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
