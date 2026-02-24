const { MongoClient } = require("mongodb");

async function run() {
  const uri = process.env.MONGODB_URI || "mongodb://127.0.0.1:27017";
  const dbName = process.env.MONGODB_DB || "cbsp";

  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  console.log(`[migration] connected: ${uri} db=${dbName}`);

  await db.collection("users").createIndexes([
    { key: { id: 1 }, name: "users_id_unique", unique: true },
    { key: { username: 1 }, name: "users_username_unique", unique: true },
    { key: { email: 1 }, name: "users_email_unique", unique: true },
  ]);

  await db.collection("customers").createIndexes([
    { key: { id: 1 }, name: "customers_id_unique", unique: true },
    { key: { email: 1 }, name: "customers_email_idx", sparse: true },
    { key: { tags: 1 }, name: "customers_tags_idx" },
    { key: { segments: 1 }, name: "customers_segments_idx" },
  ]);

  await db.collection("messages").createIndexes([
    { key: { id: 1 }, name: "messages_id_unique", unique: true },
    { key: { customerId: 1, createdAt: -1 }, name: "messages_customer_created_idx" },
    { key: { status: 1, assignedTo: 1 }, name: "messages_status_assigned_idx" },
    { key: { channel: 1, createdAt: -1 }, name: "messages_channel_created_idx" },
  ]);

  await db.collection("conversations").createIndexes([
    { key: { customerId: 1, status: 1 }, name: "conv_customer_status_idx" },
    { key: { lastMessageAt: -1 }, name: "conv_last_message_idx" },
  ]);

  await db.collection("ecommerceConnections").createIndexes([
    { key: { platform: 1, userId: 1 }, name: "ecom_platform_user_idx" },
    { key: { status: 1 }, name: "ecom_status_idx" },
  ]);

  console.log("[migration] 001_init_indexes done");
  await client.close();
}

run().catch((err) => {
  console.error("[migration] failed", err);
  process.exit(1);
});
