const { MongoClient } = require("mongodb");
const { INDEX_PLAN } = require("./001_index_plan");

async function migrateUp(options = {}) {
  const uri = options.uri || process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = options.dbName || process.env.MONGODB_DB || "cbsp";
  const quiet = Boolean(options.quiet);

  const client = new MongoClient(uri);
  try {
    await client.connect();
    const db = client.db(dbName);

    if (!quiet) {
      console.log(`[migration] connected: ${uri} db=${dbName}`);
    }

    const summary = {};
    for (const [collectionName, indexes] of Object.entries(INDEX_PLAN)) {
      const names = await db.collection(collectionName).createIndexes(indexes);
      summary[collectionName] = names;
    }

    if (!quiet) {
      console.log("[migration] 001_init_indexes done");
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
  migrateUp().catch((err) => {
    console.error("[migration] failed", err);
    process.exit(1);
  });
}

module.exports = {
  migrateUp,
};
