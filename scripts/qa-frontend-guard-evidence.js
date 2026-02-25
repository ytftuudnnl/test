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
    previewBase: process.env.CBSP_PREVIEW_BASE || "http://127.0.0.1:8775",
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
    if (arg.startsWith("--preview-base=")) {
      parsed.previewBase = arg.slice("--preview-base=".length).trim().replace(/\/+$/, "");
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
    }
  }

  return parsed;
}

function makeEvidencePath(driver, explicitOut) {
  if (explicitOut) return explicitOut;
  const stamp = new Date().toISOString().slice(0, 10);
  return path.resolve(__dirname, "../qa-evidence", `qa-frontend-guards-${driver}-${stamp}.json`);
}

function toErrorString(err) {
  return String(err && err.stack ? err.stack : err);
}

function readText(filePath) {
  return fs.readFileSync(filePath, "utf8").replace(/\r\n/g, "\n");
}

function checkIncludes(content, required) {
  const missing = required.filter((entry) => !content.includes(entry));
  return {
    pass: missing.length === 0,
    missing,
  };
}

async function fetchPage(url) {
  const res = await fetch(url);
  const body = await res.text();
  return {
    status: res.status,
    ok: res.ok,
    body,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const baseMongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const mongoDb = process.env.MONGODB_DB || `cbsp_qa_frontend_${Date.now()}`;
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
  const apiBase = `http://127.0.0.1:${address.port}`;
  const evidence = {
    ok: false,
    date: new Date().toISOString(),
    driver: options.driver,
    apiBase,
    previewBase: options.previewBase,
    checks: {
      apiErrorEnvelope: null,
      frontendGuardContracts: null,
      previewPages: null,
    },
    failures: [],
  };

  async function request(method, route, body, expectedStatus, token = "") {
    const headers = {};
    if (token) headers.authorization = `Bearer ${token}`;
    if (body !== undefined) headers["content-type"] = "application/json";

    const response = await fetch(`${apiBase}${route}`, {
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

  try {
    try {
      const noAuth = await request("GET", "/api/messages?page=1&pageSize=1", undefined, 401);
      assert.equal(noAuth.code, "AUTH_INVALID_CREDENTIALS", "missing auth should return AUTH_INVALID_CREDENTIALS");
      assert.equal(typeof noAuth.message, "string", "missing auth should include message");
      assert.equal(typeof noAuth.traceId, "string", "missing auth should include traceId");

      const badAuth = await request(
        "GET",
        "/api/messages?page=1&pageSize=1",
        undefined,
        401,
        "not-a-real-token",
      );
      assert.equal(typeof badAuth.code, "string", "invalid token should include code");
      assert.equal(typeof badAuth.message, "string", "invalid token should include message");
      assert.equal(typeof badAuth.traceId, "string", "invalid token should include traceId");

      const agentLogin = await request("POST", "/api/auth/login", {
        username: "agent.demo",
        password: "pass-1234",
      }, 200);
      const agentToken = agentLogin && agentLogin.data && agentLogin.data.token;
      assert.ok(agentToken, "agent login token missing");

      const forbidden = await request("GET", "/api/integrations", undefined, 403, agentToken);
      assert.equal(forbidden.code, "AUTH_FORBIDDEN", "agent forbidden code must be AUTH_FORBIDDEN");
      assert.equal(typeof forbidden.message, "string", "forbidden should include message");
      assert.equal(typeof forbidden.traceId, "string", "forbidden should include traceId");

      evidence.checks.apiErrorEnvelope = {
        pass: true,
        missingAuthCode: noAuth.code,
        invalidAuthCode: badAuth.code,
        forbiddenCode: forbidden.code,
        traceIds: [noAuth.traceId, badAuth.traceId, forbidden.traceId].filter(Boolean),
      };
    } catch (err) {
      evidence.checks.apiErrorEnvelope = {
        pass: false,
        error: toErrorString(err),
      };
      evidence.failures.push({ check: "apiErrorEnvelope", error: toErrorString(err) });
    }

    try {
      const workbenchPath = path.resolve(__dirname, "../apps/workbench/index.html");
      const adminPath = path.resolve(__dirname, "../apps/admin/index.html");
      const authClientPath = path.resolve(__dirname, "../apps/shared/auth-client.js");
      const apiClientPath = path.resolve(__dirname, "../apps/shared/api-client.js");

      const workbench = readText(workbenchPath);
      const admin = readText(adminPath);
      const authClient = readText(authClientPath);
      const apiClient = readText(apiClientPath);

      const workbenchCheck = checkIncludes(workbench, [
        "<script src=\"/apps/shared/api-client.js\"></script>",
        "function getFirstAllowedRoute()",
        "function syncNavAccess()",
        "setRoute(fallbackRoute);",
        "Redirecting to",
        "if (error && error.status === 401) {",
        "auth.logout();",
        "if (button.disabled) return;",
        "if (api && typeof api.formatError === \"function\") return api.formatError(error);",
      ]);

      const adminCheck = checkIncludes(admin, [
        "<script src=\"/apps/shared/api-client.js\"></script>",
        "function getFirstAllowedRoute()",
        "function syncNavAccess()",
        "setRoute(fallbackRoute);",
        "Redirecting to",
        "if (error && error.status === 401) {",
        "auth.logout();",
        "if (button.disabled) return;",
        "if (api && typeof api.formatError === \"function\") return api.formatError(error);",
      ]);

      const authClientCheck = checkIncludes(authClient, [
        "function normalizeError(error)",
        "function formatError(error)",
        "normalizeError: normalizeError",
        "formatError: formatError",
      ]);

      const apiClientCheck = checkIncludes(apiClient, [
        "function normalizeError(error)",
        "function formatError(error)",
        "normalizeError: normalizeWithAuth",
        "formatError: formatWithAuth",
        "await auth.fetchJson(\"/health\", { auth: false, retry: false })",
      ]);

      const pass =
        workbenchCheck.pass &&
        adminCheck.pass &&
        authClientCheck.pass &&
        apiClientCheck.pass;

      evidence.checks.frontendGuardContracts = {
        pass,
        workbench: workbenchCheck,
        admin: adminCheck,
        authClient: authClientCheck,
        apiClient: apiClientCheck,
      };
      if (!pass) {
        evidence.failures.push({
          check: "frontendGuardContracts",
          error: "missing required frontend guard or error-contract snippet",
        });
      }
    } catch (err) {
      evidence.checks.frontendGuardContracts = {
        pass: false,
        error: toErrorString(err),
      };
      evidence.failures.push({ check: "frontendGuardContracts", error: toErrorString(err) });
    }

    try {
      const workbenchPage = await fetchPage(`${options.previewBase}/apps/workbench/`);
      const adminPage = await fetchPage(`${options.previewBase}/apps/admin/`);

      const workbenchScripts = checkIncludes(workbenchPage.body, [
        "/apps/shared/auth-client.js",
        "/apps/shared/api-client.js",
      ]);
      const adminScripts = checkIncludes(adminPage.body, [
        "/apps/shared/auth-client.js",
        "/apps/shared/api-client.js",
      ]);

      assert.equal(workbenchPage.status, 200, "workbench preview must be 200");
      assert.equal(adminPage.status, 200, "admin preview must be 200");
      assert.ok(workbenchScripts.pass, "workbench preview missing shared scripts");
      assert.ok(adminScripts.pass, "admin preview missing shared scripts");

      evidence.checks.previewPages = {
        pass: true,
        workbenchStatus: workbenchPage.status,
        adminStatus: adminPage.status,
      };
    } catch (err) {
      evidence.checks.previewPages = {
        pass: false,
        error: toErrorString(err),
      };
      evidence.failures.push({ check: "previewPages", error: toErrorString(err) });
    }

    evidence.ok = Object.values(evidence.checks).every((item) => item && item.pass);

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

    console.log(JSON.stringify({
      ok: evidence.ok,
      out: outPath,
      checks: evidence.checks,
      failures: evidence.failures,
      driver: options.driver,
      apiBase,
      previewBase: options.previewBase,
      mongoRuntime: mongoRuntime ? mongoRuntime.details : undefined,
    }, null, 2));

    if (!evidence.ok) process.exit(1);
  } finally {
    await new Promise((resolve) => server.close(() => resolve()));
    await data.closeDataRepository();
    if (mongoRuntime) {
      await mongoRuntime.cleanup();
    }
  }
}

main().catch((err) => {
  console.error(toErrorString(err));
  process.exit(1);
});

// ci-trigger: required api check for protected main
