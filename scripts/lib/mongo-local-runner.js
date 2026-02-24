const fs = require("node:fs");
const net = require("node:net");
const path = require("node:path");
const { spawn } = require("node:child_process");

const DEFAULT_MONGOD_EXE =
  process.env.MONGOD_EXE ||
  "C:\\Users\\xds\\tools\\mongodb-win32-x86_64-windows-8.0.6\\bin\\mongod.exe";

function parseMongoEndpoint(uri) {
  try {
    const parsed = new URL(uri);
    if (parsed.protocol !== "mongodb:") return null;
    return {
      host: parsed.hostname || "127.0.0.1",
      port: Number(parsed.port || 27017),
    };
  } catch {
    return null;
  }
}

function tryConnect(host, port, timeoutMs = 600) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host, port });
    let done = false;

    function finish(ok) {
      if (done) return;
      done = true;
      try {
        socket.destroy();
      } catch {
        // ignore
      }
      resolve(ok);
    }

    socket.setTimeout(timeoutMs, () => finish(false));
    socket.on("connect", () => finish(true));
    socket.on("error", () => finish(false));
  });
}

async function waitForPortOpen(host, port, timeoutMs = 15000, shouldAbort) {
  const startedAt = Date.now();
  while (Date.now() - startedAt <= timeoutMs) {
    if (typeof shouldAbort === "function" && shouldAbort()) return false;
    // eslint-disable-next-line no-await-in-loop
    const ok = await tryConnect(host, port);
    if (ok) return true;
    if (typeof shouldAbort === "function" && shouldAbort()) return false;
    // eslint-disable-next-line no-await-in-loop
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address !== "string" ? address.port : 0;
      server.close((err) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(port);
      });
    });
    server.on("error", reject);
  });
}

function tailFile(filePath, maxBytes = 4096) {
  try {
    const stat = fs.statSync(filePath);
    const start = Math.max(0, stat.size - maxBytes);
    const fd = fs.openSync(filePath, "r");
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      return buf.toString("utf8");
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return "";
  }
}

async function ensureMongoAvailability(options) {
  const {
    mongoUri,
    requireMongo,
    workdir,
    mongodExe = DEFAULT_MONGOD_EXE,
    autoStart = true,
  } = options;

  const endpoint = parseMongoEndpoint(mongoUri);
  if (!endpoint) {
    throw new Error(`Invalid mongo uri: ${mongoUri}`);
  }

  const connected = await tryConnect(endpoint.host, endpoint.port);
  if (connected) {
    return {
      uri: mongoUri,
      startedLocal: false,
      cleanup: async () => {},
      details: `using existing mongod at ${endpoint.host}:${endpoint.port}`,
    };
  }

  if (!requireMongo) {
    return {
      uri: mongoUri,
      startedLocal: false,
      cleanup: async () => {},
      details: "mongo unavailable; caller may fallback",
    };
  }

  if (!autoStart) {
    throw new Error(
      [
        `mongod required but unreachable at ${endpoint.host}:${endpoint.port}`,
        "auto-start disabled (--mongo-autostart=off).",
        "start mongo manually and retry: .\\start-mongo-local.cmd",
      ].join("\n"),
    );
  }

  if (!fs.existsSync(mongodExe)) {
    throw new Error(`mongod executable not found: ${mongodExe}`);
  }

  const port = await getFreePort();
  const dbPath = path.resolve(workdir, ".tmp", `mongo-test-${Date.now()}-${port}`);
  const logPath = path.join(dbPath, "mongod.log");
  fs.mkdirSync(dbPath, { recursive: true });

  const args = [
    "--dbpath",
    dbPath,
    "--bind_ip",
    "127.0.0.1",
    "--port",
    String(port),
    "--logpath",
    logPath,
    "--logappend",
  ];

  let child;
  try {
    child = spawn(mongodExe, args, {
      cwd: workdir,
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    });
  } catch (err) {
    throw new Error(
      [
        `failed to spawn mongod: ${err && err.message ? err.message : String(err)}`,
        "run mongo manually and retry: .\\start-mongo-local.cmd",
      ].join("\n"),
    );
  }

  let stderrBuf = "";
  let stdoutBuf = "";
  let spawnError = null;
  child.on("error", (err) => {
    spawnError = err;
  });
  child.stderr.on("data", (chunk) => {
    stderrBuf += chunk.toString("utf8");
    if (stderrBuf.length > 8192) stderrBuf = stderrBuf.slice(-8192);
  });
  child.stdout.on("data", (chunk) => {
    stdoutBuf += chunk.toString("utf8");
    if (stdoutBuf.length > 8192) stdoutBuf = stdoutBuf.slice(-8192);
  });

  const ready = await waitForPortOpen(
    "127.0.0.1",
    port,
    20000,
    () => spawnError !== null || child.exitCode !== null,
  );
  if (!ready) {
    const exitCode = child.exitCode;
    try {
      child.kill();
    } catch {
      // ignore
    }
    const logTail = tailFile(logPath);
    throw new Error(
      [
        `failed to start local mongod on 127.0.0.1:${port}`,
        `exitCode=${exitCode}`,
        spawnError ? `spawnError=${spawnError.message || String(spawnError)}` : "",
        stderrBuf ? `stderr:\n${stderrBuf}` : "",
        stdoutBuf ? `stdout:\n${stdoutBuf}` : "",
        logTail ? `logTail:\n${logTail}` : "",
      ]
        .filter(Boolean)
        .join("\n\n"),
    );
  }

  const runtimeUri = `mongodb://127.0.0.1:${port}`;

  return {
    uri: runtimeUri,
    startedLocal: true,
    details: `started local mongod at 127.0.0.1:${port}`,
    cleanup: async () => {
      if (!child.killed && child.exitCode === null) {
        await new Promise((resolve) => {
          child.once("exit", () => resolve());
          try {
            child.kill();
          } catch {
            resolve();
          }
        });
      }
      try {
        fs.rmSync(dbPath, { recursive: true, force: true });
      } catch {
        // ignore cleanup failures
      }
    },
  };
}

module.exports = {
  ensureMongoAvailability,
};
