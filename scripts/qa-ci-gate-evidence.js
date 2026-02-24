#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { runLint } = require("./lint-source");
const { runUnitTests } = require("./unit-tests");

function parseArgs(argv) {
  const parsed = { out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length).trim();
    }
  }
  return parsed;
}

function makeOutPath(explicitOut) {
  if (explicitOut) return explicitOut;
  const stamp = new Date().toISOString().slice(0, 10);
  return path.resolve(__dirname, "../qa-evidence", `ci-gate-checks-${stamp}.json`);
}

function runStep(label, command, fn) {
  const startedAt = new Date();
  let result;
  let caught = null;
  try {
    result = fn();
  } catch (err) {
    caught = err;
  }
  const finishedAt = new Date();

  const ok = !caught && Boolean(result && result.ok);
  return {
    label,
    command,
    ok,
    status: ok ? 0 : 1,
    startedAt: startedAt.toISOString(),
    finishedAt: finishedAt.toISOString(),
    durationMs: finishedAt.getTime() - startedAt.getTime(),
    details: result || null,
    error: caught ? String(caught && caught.stack ? caught.stack : caught) : "",
  };
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const outPath = makeOutPath(options.out);

  const steps = [];
  steps.push(runStep("lint", "runLint()", () => runLint()));
  if (steps[steps.length - 1].ok) {
    steps.push(
      runStep("unit", "runUnitTests({ silent: true })", () =>
        runUnitTests({ silent: true }),
      ),
    );
  }

  const ok = steps.every((step) => step.ok);
  const evidence = {
    ok,
    date: new Date().toISOString(),
    gate: "ci-lint-unit",
    steps: steps.map((step) => ({
      label: step.label,
      command: step.command,
      ok: step.ok,
      status: step.status,
      startedAt: step.startedAt,
      finishedAt: step.finishedAt,
      durationMs: step.durationMs,
      details: step.details,
      error: step.error,
    })),
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok,
        out: outPath,
        steps: evidence.steps.map((step) => ({
          label: step.label,
          ok: step.ok,
          status: step.status,
          durationMs: step.durationMs,
        })),
      },
      null,
      2,
    ),
  );

  if (!ok) process.exit(1);
}

main();
