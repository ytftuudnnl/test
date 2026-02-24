#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { ensureMongoAvailability } = require("./lib/mongo-local-runner");

function parseArgs(argv) {
  const parsed = {
    driver: "memory",
    requireMongo: false,
    mongoAutostart: true,
    port: 0,
    warmup: 6,
    iterations: 30,
    out: "",
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
    if (arg.startsWith("--port=")) {
      const value = Number(arg.slice("--port=".length));
      if (!Number.isInteger(value) || value < 0 || value > 65535) {
        throw new Error(`Invalid --port value: ${arg.slice("--port=".length)}`);
      }
      parsed.port = value;
      continue;
    }
    if (arg.startsWith("--warmup=")) {
      const value = Number(arg.slice("--warmup=".length));
      if (!Number.isInteger(value) || value < 0 || value > 2000) {
        throw new Error(`Invalid --warmup value: ${arg.slice("--warmup=".length)}`);
      }
      parsed.warmup = value;
      continue;
    }
    if (arg.startsWith("--iterations=")) {
      const value = Number(arg.slice("--iterations=".length));
      if (!Number.isInteger(value) || value <= 0 || value > 5000) {
        throw new Error(`Invalid --iterations value: ${arg.slice("--iterations=".length)}`);
      }
      parsed.iterations = value;
      continue;
    }
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length).trim();
      continue;
    }
  }

  return parsed;
}

function percentile(values, p) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[index];
}

function summarize(values) {
  if (values.length === 0) {
    return {
      count: 0,
      minMs: 0,
      avgMs: 0,
      p50Ms: 0,
      p95Ms: 0,
      p99Ms: 0,
      maxMs: 0,
    };
  }
  const sum = values.reduce((acc, n) => acc + n, 0);
  return {
    count: values.length,
    minMs: Number(Math.min(...values).toFixed(2)),
    avgMs: Number((sum / values.length).toFixed(2)),
    p50Ms: Number(percentile(values, 50).toFixed(2)),
    p95Ms: Number(percentile(values, 95).toFixed(2)),
    p99Ms: Number(percentile(values, 99).toFixed(2)),
    maxMs: Number(Math.max(...values).toFixed(2)),
  };
}

function makeOutPath(driver, explicitOut) {
  if (explicitOut) return explicitOut;
  const stamp = new Date().toISOString().slice(0, 10);
  return path.resolve(__dirname, "../qa-evidence", `perf-baseline-${driver}-${stamp}.json`);
}

async function timedRequest(base, request) {
  const startedAtNs = process.hrtime.bigint();
  const response = await fetch(`${base}${request.path}`, {
    method: request.method,
    headers: request.headers || {},
    body: request.body === undefined ? undefined : JSON.stringify(request.body),
  });
  await response.text();
  const endedAtNs = process.hrtime.bigint();
  const ms = Number(endedAtNs - startedAtNs) / 1e6;
  return {
    status: response.status,
    latencyMs: Number(ms.toFixed(2)),
  };
}

async function runScenario(base, scenario, warmup, iterations) {
  const latencies = [];
  let failures = 0;

  for (let i = 0; i < warmup; i += 1) {
    const req = scenario.makeRequest(i);
    await timedRequest(base, req);
  }

  for (let i = 0; i < iterations; i += 1) {
    const req = scenario.makeRequest(i);
    const result = await timedRequest(base, req);
    if (result.status !== scenario.expectedStatus) {
      failures += 1;
      continue;
    }
    latencies.push(result.latencyMs);
  }

  const summary = summarize(latencies);
  return {
    name: scenario.name,
    expectedStatus: scenario.expectedStatus,
    warmup,
    iterations,
    failures,
    successRate: Number((((iterations - failures) / iterations) * 100).toFixed(2)),
    summary,
    pass: failures === 0 && summary.p95Ms < 1000,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outPath = makeOutPath(options.driver, options.out);
  const baseMongoUri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const mongoDb = process.env.MONGODB_DB || `cbsp_perf_${Date.now()}`;
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
  const idSeed = Date.now();

  async function login() {
    const response = await fetch(`${base}/api/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ username: "admin.demo", password: "pass-1234" }),
    });
    if (response.status !== 200) {
      throw new Error(`login failed: status=${response.status}`);
    }
    const payload = await response.json();
    return payload.data.token;
  }

  try {
    const token = await login();
    const authHeaders = {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    };

    const customerResp = await fetch(`${base}/api/customers`, {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({
        name: `Perf Baseline User ${idSeed}`,
        email: `perf.${idSeed}@example.com`,
        tags: ["perf-baseline"],
        segments: ["ops"],
        profile: { source: "perf-baseline" },
      }),
    });
    if (customerResp.status !== 201) {
      throw new Error(`create customer failed: status=${customerResp.status}`);
    }
    const customerPayload = await customerResp.json();
    const customerId = customerPayload.data.id;

    const scenarios = [
      {
        name: "health",
        expectedStatus: 200,
        makeRequest: () => ({
          method: "GET",
          path: "/health",
        }),
      },
      {
        name: "list-customers",
        expectedStatus: 200,
        makeRequest: () => ({
          method: "GET",
          path: "/api/customers?page=1&pageSize=20",
          headers: { authorization: `Bearer ${token}` },
        }),
      },
      {
        name: "create-message",
        expectedStatus: 201,
        makeRequest: (index) => ({
          method: "POST",
          path: "/api/messages",
          headers: authHeaders,
          body: {
            customerId,
            channel: "email",
            direction: "outbound",
            content: `perf-message-${idSeed}-${index}`,
            status: "pending",
          },
        }),
      },
      {
        name: "analytics-summary",
        expectedStatus: 200,
        makeRequest: () => ({
          method: "GET",
          path: "/api/analytics/summary",
          headers: { authorization: `Bearer ${token}` },
        }),
      },
    ];

    const scenarioResults = [];
    for (const scenario of scenarios) {
      // eslint-disable-next-line no-await-in-loop
      const result = await runScenario(base, scenario, options.warmup, options.iterations);
      scenarioResults.push(result);
    }

    const allLatencies = scenarioResults.flatMap((result) => [
      result.summary.p50Ms,
      result.summary.p95Ms,
      result.summary.p99Ms,
    ]);
    const overall = summarize(allLatencies);
    const pass = scenarioResults.every((result) => result.pass);

    const evidence = {
      ok: pass,
      date: new Date().toISOString(),
      driver: options.driver,
      base,
      iterations: options.iterations,
      warmup: options.warmup,
      target: {
        apiP95Ms: 1000,
      },
      scenarios: scenarioResults,
      overall,
      mongoRuntime: mongoRuntime ? mongoRuntime.details : undefined,
    };

    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

    console.log(
      JSON.stringify(
        {
          ok: pass,
          out: outPath,
          driver: options.driver,
          scenarioCount: scenarioResults.length,
          overall,
        },
        null,
        2,
      ),
    );

    if (!pass) {
      process.exitCode = 1;
    }
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
