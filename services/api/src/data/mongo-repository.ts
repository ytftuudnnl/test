import { randomUUID } from "crypto";
import { MongoClient } from "mongodb";
import {
  AnalyticsDailyMessageRecord,
  AutomationRuleRecord,
  ChannelRecord,
  ConversationRecord,
  CustomerRecord,
  DataRepository,
  IntegrationRecord,
  MessageRecord,
  UserRecord,
} from "./types";
import { hashPassword, verifyPassword } from "../utils/password";

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

interface MongoDoc {
  _id?: unknown;
  [key: string]: unknown;
}

function stripMongoId<T extends MongoDoc>(doc: T | null): Omit<T, "_id"> | null {
  if (!doc) return null;
  const { _id, ...rest } = doc;
  return rest;
}

function stripMongoIds<T extends MongoDoc>(docs: T[]): Array<Omit<T, "_id">> {
  return docs.map((v) => stripMongoId(v) as Omit<T, "_id">);
}

function buildDailySeriesFromCounts(counts: Map<string, number>, days: number): AnalyticsDailyMessageRecord[] {
  const normalizedDays = Math.max(1, Math.min(days, 90));
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  const daily: AnalyticsDailyMessageRecord[] = [];
  for (let offset = normalizedDays - 1; offset >= 0; offset -= 1) {
    const date = new Date(today);
    date.setUTCDate(today.getUTCDate() - offset);
    const key = date.toISOString().slice(0, 10);
    daily.push({
      date: key,
      count: counts.get(key) || 0,
    });
  }
  return daily;
}

export async function createMongoRepository(uri: string, dbName: string): Promise<DataRepository> {
  const client = new MongoClient(uri);
  await client.connect();
  const db = client.db(dbName);

  const users = db.collection<UserRecord>("users");
  const customers = db.collection<CustomerRecord>("customers");
  const messages = db.collection<MessageRecord>("messages");
  const conversations = db.collection<ConversationRecord>("conversations");
  const channels = db.collection<ChannelRecord>("channels");
  const automations = db.collection<AutomationRuleRecord>("automations");
  const integrations = db.collection<IntegrationRecord>("integrations");

  async function ensureSeedData() {
    const count = await users.countDocuments();
    if (count > 0) return;

    const ts = nowIso();
    const seededPassword = hashPassword("pass-1234");

    await users.insertMany([
      {
        id: "u-admin-1",
        username: "admin.demo",
        email: "admin@example.com",
        role: "admin",
        passwordHash: seededPassword,
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "u-agent-1",
        username: "agent.demo",
        email: "agent@example.com",
        role: "agent",
        passwordHash: seededPassword,
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    await customers.insertOne({
      id: "c-1",
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+1-202-555-0101",
      tags: ["vip"],
      segments: ["high-value"],
      profile: { locale: "en-US" },
      createdAt: ts,
      updatedAt: ts,
    });

    await conversations.insertOne({
      id: "conv-1",
      customerId: "c-1",
      channel: "whatsapp",
      channelId: "wa-conv-1001",
      status: "open",
      lastMessageAt: ts,
      createdAt: ts,
      updatedAt: ts,
    });

    await messages.insertOne({
      id: "m-1",
      conversationId: "conv-1",
      customerId: "c-1",
      channel: "whatsapp",
      channelId: "wa-1001",
      direction: "inbound",
      content: "Where is my order?",
      translatedContent: "Where is my order?",
      status: "processed",
      assignedTo: "u-agent-1",
      createdAt: ts,
      updatedAt: ts,
    });

    await channels.insertMany([
      {
        id: "ch-whatsapp",
        type: "whatsapp",
        config: { webhook: "https://example.com/whatsapp/webhook" },
        status: "connected",
        testedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "ch-email",
        type: "email",
        config: { provider: "smtp" },
        status: "connected",
        testedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
    ]);

    await automations.insertOne({
      id: "rule-1",
      name: "Order Delay Follow-up",
      type: "workflow",
      trigger: { event: "order.delayed" },
      actions: [{ type: "send_message", template: "delay_notice" }],
      enabled: true,
      createdAt: ts,
      updatedAt: ts,
    });

    await integrations.insertMany([
      {
        id: "int-shopify",
        platform: "shopify",
        status: "connected",
        syncedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
      {
        id: "int-amazon",
        platform: "amazon",
        status: "connected",
        syncedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      },
    ]);
  }

  await ensureSeedData();

  return {
    async findUserByCredentials(username, password) {
      const found = await users.findOne({ username });
      const user = stripMongoId(found);
      if (!user) return null;
      if (!verifyPassword(password, user.passwordHash)) return null;
      return user;
    },

    async existsUserByUsernameOrEmail(username, email) {
      const count = await users.countDocuments({ $or: [{ username }, { email }] });
      return count > 0;
    },

    async createUser(input) {
      const ts = nowIso();
      const user: UserRecord = {
        id: makeId("u"),
        username: input.username,
        email: input.email,
        role: input.role,
        passwordHash: input.passwordHash,
        createdAt: ts,
        updatedAt: ts,
      };
      await users.insertOne({ ...user });
      return user;
    },

    async listCustomers(args) {
      const where: Record<string, unknown> = {};
      if (args.q) {
        const regex = { $regex: args.q, $options: "i" };
        where.$or = [{ id: regex }, { name: regex }, { email: regex }];
      }
      const total = await customers.countDocuments(where);
      const items = await customers
        .find(where)
        .skip((args.page - 1) * args.pageSize)
        .limit(args.pageSize)
        .sort({ updatedAt: -1 })
        .toArray();
      return {
        items: stripMongoIds(items),
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          hasNext: args.page * args.pageSize < total,
        },
      };
    },

    async getCustomerById(id) {
      const doc = await customers.findOne({ id });
      return stripMongoId(doc);
    },

    async createCustomer(input) {
      const ts = nowIso();
      const doc: CustomerRecord = {
        id: makeId("c"),
        ...input,
        createdAt: ts,
        updatedAt: ts,
      };
      await customers.insertOne({ ...doc });
      return doc;
    },

    async updateCustomer(id, patch) {
      const ts = nowIso();
      const result = await customers.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async deleteCustomer(id) {
      const result = await customers.deleteOne({ id });
      await messages.deleteMany({ customerId: id });
      await conversations.deleteMany({ customerId: id });
      return result.deletedCount > 0;
    },

    async listMessages(args) {
      const where: Record<string, unknown> = {};
      if (args.customerId) where.customerId = args.customerId;
      if (args.status) where.status = args.status;
      if (args.channel) where.channel = args.channel;

      const total = await messages.countDocuments(where);
      const items = await messages
        .find(where)
        .skip((args.page - 1) * args.pageSize)
        .limit(args.pageSize)
        .sort({ createdAt: -1 })
        .toArray();
      return {
        items: stripMongoIds(items),
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          hasNext: args.page * args.pageSize < total,
        },
      };
    },

    async getMessageById(id) {
      const doc = await messages.findOne({ id });
      return stripMongoId(doc);
    },

    async createMessage(input) {
      const ts = nowIso();
      const doc: MessageRecord = {
        id: makeId("m"),
        ...input,
        createdAt: ts,
        updatedAt: ts,
      };
      await messages.insertOne({ ...doc });
      if (doc.conversationId) {
        await conversations.updateOne(
          { id: doc.conversationId },
          { $set: { lastMessageAt: ts, updatedAt: ts } },
        );
      }
      return doc;
    },

    async updateMessage(id, patch) {
      const ts = nowIso();
      const result = await messages.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async listConversations(args) {
      const where: Record<string, unknown> = {};
      if (args.customerId) where.customerId = args.customerId;
      if (args.status) where.status = args.status;
      if (args.channel) where.channel = args.channel;

      const total = await conversations.countDocuments(where);
      const items = await conversations
        .find(where)
        .skip((args.page - 1) * args.pageSize)
        .limit(args.pageSize)
        .sort({ lastMessageAt: -1 })
        .toArray();

      return {
        items: stripMongoIds(items),
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          hasNext: args.page * args.pageSize < total,
        },
      };
    },

    async getConversationById(id) {
      const doc = await conversations.findOne({ id });
      return stripMongoId(doc);
    },

    async createConversation(input) {
      const ts = nowIso();
      const doc: ConversationRecord = {
        id: makeId("conv"),
        ...input,
        lastMessageAt: ts,
        createdAt: ts,
        updatedAt: ts,
      };
      await conversations.insertOne({ ...doc });
      return doc;
    },

    async updateConversation(id, patch) {
      const ts = nowIso();
      const result = await conversations.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async listMessagesByConversationId(conversationId) {
      const docs = await messages.find({ conversationId }).sort({ createdAt: 1 }).toArray();
      return stripMongoIds(docs);
    },

    async listChannels() {
      const docs = await channels.find({}).sort({ updatedAt: -1 }).toArray();
      return stripMongoIds(docs);
    },

    async getChannelById(id) {
      const doc = await channels.findOne({ id });
      return stripMongoId(doc);
    },

    async createChannel(input) {
      const ts = nowIso();
      const doc: ChannelRecord = {
        id: makeId("ch"),
        ...input,
        status: "connected",
        testedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      };
      await channels.insertOne({ ...doc });
      return doc;
    },

    async updateChannel(id, patch) {
      const ts = nowIso();
      const result = await channels.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async deleteChannel(id) {
      const result = await channels.deleteOne({ id });
      return result.deletedCount > 0;
    },

    async testChannel(id) {
      const ts = nowIso();
      const result = await channels.findOneAndUpdate(
        { id },
        { $set: { status: "connected", testedAt: ts, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async listAutomations(args) {
      const where: Record<string, unknown> = {};
      if (args.type) where.type = args.type;
      if (args.enabled === "true") where.enabled = true;
      if (args.enabled === "false") where.enabled = false;

      const total = await automations.countDocuments(where);
      const items = await automations
        .find(where)
        .skip((args.page - 1) * args.pageSize)
        .limit(args.pageSize)
        .sort({ updatedAt: -1 })
        .toArray();

      return {
        items: stripMongoIds(items),
        pagination: {
          page: args.page,
          pageSize: args.pageSize,
          total,
          hasNext: args.page * args.pageSize < total,
        },
      };
    },

    async getAutomationById(id) {
      const doc = await automations.findOne({ id });
      return stripMongoId(doc);
    },

    async createAutomation(input) {
      const ts = nowIso();
      const doc: AutomationRuleRecord = {
        id: makeId("rule"),
        name: input.name,
        type: input.type,
        trigger: input.trigger,
        actions: input.actions,
        enabled: input.enabled ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      await automations.insertOne({ ...doc });
      return doc;
    },

    async updateAutomation(id, patch) {
      const ts = nowIso();
      const result = await automations.findOneAndUpdate(
        { id },
        { $set: { ...patch, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async deleteAutomation(id) {
      const result = await automations.deleteOne({ id });
      return result.deletedCount > 0;
    },

    async getAnalyticsSummary() {
      const totalMessages = await messages.countDocuments();
      const totalCustomers = await customers.countDocuments();
      const avgResponseMs = totalMessages === 0 ? 0 : Math.max(180, 900 - totalMessages * 10);
      const translationP95Ms = totalMessages === 0 ? 0 : Math.max(120, Math.floor(avgResponseMs * 0.7));

      return {
        totalMessages,
        totalCustomers,
        avgResponseMs,
        translationP95Ms,
      };
    },

    async getAnalyticsMessageTrend(days) {
      const normalizedDays = Math.max(1, Math.min(days, 90));
      const start = new Date();
      start.setUTCHours(0, 0, 0, 0);
      start.setUTCDate(start.getUTCDate() - (normalizedDays - 1));
      const startIso = start.toISOString();

      const grouped = await messages.aggregate<{ _id: string; count: number }>([
        { $match: { createdAt: { $gte: startIso } } },
        { $group: { _id: { $substrBytes: ["$createdAt", 0, 10] }, count: { $sum: 1 } } },
        { $sort: { _id: 1 } },
      ]).toArray();

      const counts = new Map<string, number>();
      for (const item of grouped) {
        counts.set(item._id, item.count);
      }
      return buildDailySeriesFromCounts(counts, normalizedDays);
    },

    async listIntegrations() {
      const docs = await integrations.find({}).sort({ updatedAt: -1 }).toArray();
      return stripMongoIds(docs);
    },

    async getIntegrationById(id) {
      const doc = await integrations.findOne({ id });
      return stripMongoId(doc);
    },

    async syncIntegration(id) {
      const ts = nowIso();
      const result = await integrations.findOneAndUpdate(
        { id },
        { $set: { status: "synced", syncedAt: ts, updatedAt: ts } },
        { returnDocument: "after" },
      );
      return stripMongoId(result);
    },

    async close() {
      await client.close();
    },
  };
}
