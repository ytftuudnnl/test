#!/usr/bin/env node
const assert = require("node:assert/strict");

const { hashPassword, verifyPassword } = require("../services/api/dist/utils/password");
const {
  issueAccessToken,
  issueRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
} = require("../services/api/dist/utils/tokens");

const tests = [];

function test(name, fn) {
  tests.push({ name, fn });
}

test("password hash should be scrypt scheme and verifiable", () => {
  const hashed = hashPassword("pass-1234");
  assert.match(hashed, /^scrypt\$/);
  assert.equal(verifyPassword("pass-1234", hashed), true);
  assert.equal(verifyPassword("wrong-pass", hashed), false);
});

test("legacy plain password compatibility should still work", () => {
  assert.equal(verifyPassword("pass-1234", "pass-1234"), true);
  assert.equal(verifyPassword("pass-1234", "pass-1234x"), false);
  assert.equal(verifyPassword("pass-1234", ""), false);
});

test("issued access token should verify and keep subject/role/session", () => {
  const issued = issueAccessToken({
    userId: "u-admin-1",
    role: "admin",
    sessionId: "session-abc",
  });

  assert.equal(typeof issued.token, "string");
  assert.ok(issued.token.split(".").length === 3);

  const claims = verifyAccessToken(issued.token);
  assert.equal(claims.sub, "u-admin-1");
  assert.equal(claims.role, "admin");
  assert.equal(claims.sid, "session-abc");
  assert.equal(claims.typ, "access");
  assert.ok(claims.exp > claims.iat);
});

test("issued refresh token should verify and reject wrong verifier", () => {
  const issued = issueRefreshToken({
    userId: "u-agent-1",
    role: "agent",
    sessionId: "session-xyz",
  });

  const refreshClaims = verifyRefreshToken(issued.token);
  assert.equal(refreshClaims.sub, "u-agent-1");
  assert.equal(refreshClaims.role, "agent");
  assert.equal(refreshClaims.sid, "session-xyz");
  assert.equal(refreshClaims.typ, "refresh");
  assert.equal(refreshClaims.jti, issued.jti);
  assert.equal(refreshClaims.sid, issued.sessionId);

  assert.throws(
    () => verifyAccessToken(issued.token),
    /Invalid token signature|Invalid token type/,
  );
});

function runUnitTests(options = {}) {
  const silent = Boolean(options.silent);
  const failures = [];
  const startedAt = Date.now();

  for (const entry of tests) {
    try {
      entry.fn();
      if (!silent) {
        console.log(`[unit] pass: ${entry.name}`);
      }
    } catch (err) {
      failures.push({ name: entry.name, error: err });
      if (!silent) {
        console.error(`[unit] fail: ${entry.name}`);
        console.error(err && err.stack ? err.stack : String(err));
      }
    }
  }

  const durationMs = Date.now() - startedAt;
  const result = {
    ok: failures.length === 0,
    total: tests.length,
    passed: tests.length - failures.length,
    failed: failures.length,
    durationMs,
    failures: failures.map((entry) => ({
      name: entry.name,
      error: entry.error && entry.error.stack ? entry.error.stack : String(entry.error),
    })),
  };

  if (!silent) {
    console.log(
      `[unit] summary: total=${result.total} passed=${result.passed} failed=${result.failed} durationMs=${result.durationMs}`,
    );
  }

  return result;
}

function main() {
  const result = runUnitTests();
  if (!result.ok) {
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = {
  runUnitTests,
};
