#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");

const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
const maxFileBytes = 2 * 1024 * 1024;

const ignoredDirs = new Set([
  ".git",
  "node_modules",
  "dist",
  ".next",
  ".npm-cache",
  "coverage",
  "build",
  "out",
  ".idea",
  ".vscode",
]);

const ignoredExtensions = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".ico",
  ".pdf",
  ".zip",
  ".gz",
  ".7z",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".mp4",
  ".mov",
  ".webm",
  ".avi",
  ".mp3",
  ".wav",
  ".jar",
  ".class",
  ".pyc",
  ".o",
  ".a",
  ".lib",
]);

const rules = [
  {
    name: "Private key block",
    regex: /-----BEGIN (?:[A-Z ]+)?PRIVATE KEY-----/g,
  },
  {
    name: "AWS access key",
    regex: /\bAKIA[0-9A-Z]{16}\b/g,
  },
  {
    name: "GitHub token",
    regex: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
  },
  {
    name: "Google API key",
    regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  },
  {
    name: "Slack token",
    regex: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  },
  {
    name: "Credentialed connection URI",
    regex: /\b(?:mongodb(?:\+srv)?|postgres(?:ql)?|mysql|redis):\/\/[^/\s:@]+:[^@\s]+@/gi,
  },
];

function isIgnoredDir(name) {
  return ignoredDirs.has(name.toLowerCase());
}

function isIgnoredFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return ignoredExtensions.has(ext);
}

function findLine(text, index) {
  let line = 1;
  for (let i = 0; i < index; i += 1) {
    if (text.charCodeAt(i) === 10) line += 1;
  }
  return line;
}

function listFiles(baseDir) {
  const out = [];
  const stack = [baseDir];

  while (stack.length > 0) {
    const current = stack.pop();
    const entries = fs.readdirSync(current, { withFileTypes: true });
    for (const entry of entries) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        if (!isIgnoredDir(entry.name)) {
          stack.push(full);
        }
        continue;
      }
      if (entry.isFile()) {
        out.push(full);
      }
    }
  }
  return out;
}

function scanFile(filePath) {
  const stat = fs.statSync(filePath);
  if (stat.size === 0 || stat.size > maxFileBytes) return [];
  if (isIgnoredFile(filePath)) return [];

  const content = fs.readFileSync(filePath, "utf8");
  if (content.includes("\u0000")) return [];

  const findings = [];
  for (const rule of rules) {
    rule.regex.lastIndex = 0;
    let match;
    while ((match = rule.regex.exec(content)) !== null) {
      findings.push({
        rule: rule.name,
        line: findLine(content, match.index),
        sample: String(match[0]).slice(0, 80),
      });
    }
  }
  return findings;
}

function main() {
  if (!fs.existsSync(root)) {
    console.error(`[secret-scan] target not found: ${root}`);
    process.exit(1);
  }

  const files = listFiles(root);
  const allFindings = [];

  for (const file of files) {
    const findings = scanFile(file);
    if (findings.length === 0) continue;
    const rel = path.relative(root, file).replace(/\\/g, "/");
    for (const finding of findings) {
      allFindings.push({
        file: rel,
        ...finding,
      });
    }
  }

  if (allFindings.length === 0) {
    console.log(`[secret-scan] clean (${files.length} files scanned)`);
    return;
  }

  console.error(`[secret-scan] ${allFindings.length} potential secret(s) found:`);
  for (const finding of allFindings) {
    console.error(`- ${finding.file}:${finding.line} [${finding.rule}] ${finding.sample}`);
  }
  process.exit(1);
}

main();
