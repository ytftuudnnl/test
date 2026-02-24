const { MongoClient } = require("mongodb");
const { INDEX_NAMES } = require("./001_index_plan");

async function hasCollection(db, collectionName) {
  const match = await db
    .listCollections({ name: collectionName }, { nameOnly: true })
    .toArray();
  return match.length > 0;
}

async function migrateDown(options = {}) {
  const uri = options.uri || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = options.dbName || process.env.MONGODB_DB || "cbsp";
  const quiet = Boolean(options.quiet);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    if (!quiet) {
      console.log(`[migration:down] connected: ${uri} db=${dbName}`);
    }

    const summary = {};
    for (const [collectionName, indexNames] of Object.entries(INDEX_NAMES)) {
      summary[collectionName] = [];
      const exists = await hasCollection(db, collectionName);
      if (!exists) {
        summary[collectionName].push({ index: "(collection-missing)", dropped: false });
        continue;
      }

      const collection = db.collection(collectionName);
      const existing = await collection.indexes();
      const existingNames = new Set(existing.map((entry) => entry.name));

      for (const indexName of indexNames) {
        if (!existingNames.has(indexName)) {
          summary[collectionName].push({ index: indexName, dropped: false });
          continue;
        }
        await collection.dropIndex(indexName);
        summary[collectionName].push({ index: indexName, dropped: true });
      }
    }

    if (!quiet) {
      console.log("[migration:down] 001_init_indexes rollback done");
    }

    return {
      ok: true,
      uri,
      dbName,
      summary,
    };
  } finally {
    await client.close();
  }
}

if (require.main === module) {
  migrateDown().catch((err) => {
    console.error("[migration:down] failed", err);
    process.exit(1);
  });
}

module.exports = {
  migrateDown,
};
