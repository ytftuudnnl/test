#!/usr/bin/env node
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { MongoClient } = require("mongodb");
const { INDEX_NAMES } = require("../services/api/database/migrations/001_index_plan");
const { migrateUp } = require("../services/api/database/migrations/001_init_indexes");
const { migrateDown } = require("../services/api/database/migrations/001_init_indexes.down");

function parseArgs(argv) {
  const parsed = { out: "" };
  for (const arg of argv) {
    if (arg.startsWith("--out=")) {
      parsed.out = arg.slice("--out=".length).trim();
    }
  }
  return parsed;
}

function defaultEvidencePath() {
  const stamp = new Date().toISOString().slice(0, 10);
  return path.resolve(__dirname, "../qa-evidence", `migration-rollback-drill-${stamp}.json`);
}

async function hasCollection(db, collectionName) {
  const match = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  return match.length > 0;
}

async function snapshotIndexes(db) {
  const out = {};
  for (const collectionName of Object.keys(INDEX_NAMES)) {
    if (!(await hasCollection(db, collectionName))) {
      out[collectionName] = [];
      continue;
    }
    const indexes = await db.collection(collectionName).indexes();
    out[collectionName] = indexes.map((entry) => entry.name).sort();
  }
  return out;
}

function verifyUp(snapshot) {
  for (const [collectionName, expectedIndexes] of Object.entries(INDEX_NAMES)) {
    const existing = new Set(snapshot[collectionName] || []);
    for (const indexName of expectedIndexes) {
      assert.ok(
        existing.has(indexName),
        `missing expected index after migrateUp: ${collectionName}.${indexName}`,
      );
    }
  }
}

function verifyDown(snapshot) {
  for (const [collectionName, expectedIndexes] of Object.entries(INDEX_NAMES)) {
    const existing = new Set(snapshot[collectionName] || []);
    for (const indexName of expectedIndexes) {
      assert.ok(
        !existing.has(indexName),
        `index should be removed after migrateDown: ${collectionName}.${indexName}`,
      );
    }
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const outPath = options.out || defaultEvidencePath();
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB || `cbsp_migration_drill_${Date.now()}`;

  const prepClient = new MongoClient(uri);
  await prepClient.connect();
  try {
    await prepClient.db(dbName).dropDatabase();
  } finally {
    await prepClient.close();
  }

  const upResult = await migrateUp({ uri, dbName, quiet: true });

  const verifyClient = new MongoClient(uri);
  await verifyClient.connect();
  let afterUp;
  let afterDown;
  try {
    const db = verifyClient.db(dbName);
    afterUp = await snapshotIndexes(db);
    verifyUp(afterUp);
  } finally {
    await verifyClient.close();
  }

  const downResult = await migrateDown({ uri, dbName, quiet: true });

  const verifyDownClient = new MongoClient(uri);
  await verifyDownClient.connect();
  try {
    const db = verifyDownClient.db(dbName);
    afterDown = await snapshotIndexes(db);
    verifyDown(afterDown);
  } finally {
    await verifyDownClient.close();
  }

  const evidence = {
    ok: true,
    date: new Date().toISOString(),
    uri,
    dbName,
    migration: "001_init_indexes",
    upSummary: upResult.summary,
    downSummary: downResult.summary,
    snapshotAfterUp: afterUp,
    snapshotAfterDown: afterDown,
  };

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, JSON.stringify(evidence, null, 2), "utf8");

  console.log(
    JSON.stringify(
      {
        ok: true,
        out: outPath,
        dbName,
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err && err.stack ? err.stack : String(err));
  process.exit(1);
});
