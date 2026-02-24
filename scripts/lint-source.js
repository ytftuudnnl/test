#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const TARGETS = [
  path.join(ROOT, "services", "api", "src"),
  path.join(ROOT, "scripts"),
  path.join(ROOT, "tests"),
];
const ALLOWED_CONSOLE_LOG = new Set([
  normalize(path.join(ROOT, "services", "api", "src", "server.ts")),
]);
const SCAN_EXTENSIONS = new Set([".ts", ".js", ".mjs", ".cjs"]);
const MERGE_MARKER_PATTERNS = [
  { token: "<<<<<<<", pattern: /^\s*<<<<<<<\s/ },
  { token: "=======", pattern: /^\s*=======\s*$/ },
  { token: ">>>>>>>", pattern: /^\s*>>>>>>>\s/ },
];

function normalize(value) {
  return value.replace(/\\/g, "/");
}

function walk(dir, out) {
  if (!fs.existsSync(dir)) return;
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      walk(fullPath, out);
      continue;
    }
    const ext = path.extname(entry.name).toLowerCase();
    if (SCAN_EXTENSIONS.has(ext)) out.push(fullPath);
  }
}

function lintFile(filePath, findings) {
  const text = fs.readFileSync(filePath, "utf8");
  const normalizedPath = normalize(filePath);
  const lines = text.split(/\r?\n/);

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const lineNo = index + 1;
    for (const rule of MERGE_MARKER_PATTERNS) {
      if (rule.pattern.test(line)) {
        findings.push({
          file: normalizedPath,
          line: lineNo,
          rule: "merge-marker",
          message: `Unresolved merge marker: ${rule.token}`,
        });
      }
    }

    if (/^\s*debugger\s*;?\s*$/.test(line)) {
      findings.push({
        file: normalizedPath,
        line: lineNo,
        rule: "debugger-statement",
        message: "Remove debugger statement before merge.",
      });
    }

    if (
      line.includes("console.log(") &&
      normalizedPath.includes("/services/api/src/") &&
      !ALLOWED_CONSOLE_LOG.has(normalizedPath)
    ) {
      findings.push({
        file: normalizedPath,
        line: lineNo,
        rule: "no-console-log",
        message: "console.log is restricted in API source (except server bootstrap).",
      });
    }
  }
}

function runLint() {
  const files = [];
  for (const target of TARGETS) walk(target, files);

  const findings = [];
  for (const file of files) {
    lintFile(file, findings);
  }

  return {
    ok: findings.length === 0,
    filesScanned: files.length,
    findings,
  };
}

function main() {
  const result = runLint();
  if (!result.ok) {
    console.error(`[lint-source] failed: ${result.findings.length} finding(s)`);
    for (const finding of result.findings) {
      console.error(
        `${finding.file}:${finding.line} [${finding.rule}] ${finding.message}`,
      );
    }
    process.exit(1);
  }
  console.log(`[lint-source] clean (${result.filesScanned} files scanned)`);
}

if (require.main === module) {
  main();
}

module.exports = {
  runLint,
};
