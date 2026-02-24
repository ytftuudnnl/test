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
import { randomUUID } from "crypto";

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${randomUUID().slice(0, 8)}`;
}

function paginate<T>(items: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  const paged = items.slice(start, start + pageSize);
  return {
    items: paged,
    pagination: {
      page,
      pageSize,
      total: items.length,
      hasNext: start + pageSize < items.length,
    },
  };
}

function buildDailySeries(createdAts: string[], days: number): AnalyticsDailyMessageRecord[] {
  const normalizedDays = Math.max(1, Math.min(days, 90));
  const counts = new Map<string, number>();

  for (const createdAt of createdAts) {
    const parsed = new Date(createdAt);
    if (Number.isNaN(parsed.getTime())) continue;
    const key = parsed.toISOString().slice(0, 10);
    counts.set(key, (counts.get(key) || 0) + 1);
  }

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

export function createMemoryRepository(): DataRepository {
  const users: UserRecord[] = [
    {
      id: "u-admin-1",
      username: "admin.demo",
      email: "admin@example.com",
      role: "admin",
      passwordHash: "pass-1234",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: "u-agent-1",
      username: "agent.demo",
      email: "agent@example.com",
      role: "agent",
      passwordHash: "pass-1234",
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const customers: CustomerRecord[] = [
    {
      id: "c-1",
      name: "Demo Customer",
      email: "demo@example.com",
      phone: "+1-202-555-0101",
      tags: ["vip"],
      segments: ["high-value"],
      profile: { locale: "en-US" },
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const conversations: ConversationRecord[] = [
    {
      id: "conv-1",
      customerId: "c-1",
      channel: "whatsapp",
      channelId: "wa-conv-1001",
      status: "open",
      lastMessageAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const messages: MessageRecord[] = [
    {
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
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const channels: ChannelRecord[] = [
    {
      id: "ch-whatsapp",
      type: "whatsapp",
      config: { webhook: "https://example.com/whatsapp/webhook" },
      status: "connected",
      testedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: "ch-email",
      type: "email",
      config: { provider: "smtp" },
      status: "connected",
      testedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const automations: AutomationRuleRecord[] = [
    {
      id: "rule-1",
      name: "Order Delay Follow-up",
      type: "workflow",
      trigger: { event: "order.delayed" },
      actions: [{ type: "send_message", template: "delay_notice" }],
      enabled: true,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  const integrations: IntegrationRecord[] = [
    {
      id: "int-shopify",
      platform: "shopify",
      status: "connected",
      syncedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
    {
      id: "int-amazon",
      platform: "amazon",
      status: "connected",
      syncedAt: nowIso(),
      createdAt: nowIso(),
      updatedAt: nowIso(),
    },
  ];

  return {
    async findUserByCredentials(username, password) {
      return users.find((v) => v.username === username && v.passwordHash === password) || null;
    },

    async existsUserByUsernameOrEmail(username, email) {
      return users.some((v) => v.username === username || v.email === email);
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
      users.push(user);
      return user;
    },

    async listCustomers(args) {
      const q = String(args.q || "").toLowerCase().trim();
      const filtered = customers.filter((v) => {
        if (!q) return true;
        return (
          v.id.toLowerCase().includes(q) ||
          String(v.name || "").toLowerCase().includes(q) ||
          String(v.email || "").toLowerCase().includes(q)
        );
      });
      return paginate(filtered, args.page, args.pageSize);
    },

    async getCustomerById(id) {
      return customers.find((v) => v.id === id) || null;
    },

    async createCustomer(input) {
      const ts = nowIso();
      const customer: CustomerRecord = {
        id: makeId("c"),
        ...input,
        createdAt: ts,
        updatedAt: ts,
      };
      customers.push(customer);
      return customer;
    },

    async updateCustomer(id, patch) {
      const found = customers.find((v) => v.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      found.updatedAt = nowIso();
      return found;
    },

    async deleteCustomer(id) {
      const idx = customers.findIndex((v) => v.id === id);
      if (idx < 0) return false;
      customers.splice(idx, 1);

      for (let i = messages.length - 1; i >= 0; i -= 1) {
        if (messages[i].customerId === id) messages.splice(i, 1);
      }
      for (let i = conversations.length - 1; i >= 0; i -= 1) {
        if (conversations[i].customerId === id) conversations.splice(i, 1);
      }
      return true;
    },

    async listMessages(args) {
      const filtered = messages.filter((v) => {
        if (args.customerId && v.customerId !== args.customerId) return false;
        if (args.status && v.status !== args.status) return false;
        if (args.channel && v.channel !== args.channel) return false;
        return true;
      });
      return paginate(filtered, args.page, args.pageSize);
    },

    async getMessageById(id) {
      return messages.find((v) => v.id === id) || null;
    },

    async createMessage(input) {
      const ts = nowIso();
      const message: MessageRecord = {
        id: makeId("m"),
        ...input,
        createdAt: ts,
        updatedAt: ts,
      };
      messages.push(message);

      if (message.conversationId) {
        const conv = conversations.find((v) => v.id === message.conversationId);
        if (conv) {
          conv.lastMessageAt = ts;
          conv.updatedAt = ts;
        }
      }
      return message;
    },

    async updateMessage(id, patch) {
      const found = messages.find((v) => v.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      found.updatedAt = nowIso();
      return found;
    },

    async listConversations(args) {
      const filtered = conversations.filter((v) => {
        if (args.customerId && v.customerId !== args.customerId) return false;
        if (args.status && v.status !== args.status) return false;
        if (args.channel && v.channel !== args.channel) return false;
        return true;
      });
      filtered.sort((a, b) => b.lastMessageAt.localeCompare(a.lastMessageAt));
      return paginate(filtered, args.page, args.pageSize);
    },

    async getConversationById(id) {
      return conversations.find((v) => v.id === id) || null;
    },

    async createConversation(input) {
      const ts = nowIso();
      const conv: ConversationRecord = {
        id: makeId("conv"),
        ...input,
        status: input.status || "open",
        lastMessageAt: ts,
        createdAt: ts,
        updatedAt: ts,
      };
      conversations.push(conv);
      return conv;
    },

    async updateConversation(id, patch) {
      const found = conversations.find((v) => v.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      found.updatedAt = nowIso();
      return found;
    },

    async listMessagesByConversationId(conversationId) {
      return messages.filter((v) => v.conversationId === conversationId);
    },

    async listChannels() {
      return [...channels];
    },

    async getChannelById(id) {
      return channels.find((v) => v.id === id) || null;
    },

    async createChannel(input) {
      const ts = nowIso();
      const channel: ChannelRecord = {
        id: makeId("ch"),
        ...input,
        status: "connected",
        testedAt: ts,
        createdAt: ts,
        updatedAt: ts,
      };
      channels.push(channel);
      return channel;
    },

    async updateChannel(id, patch) {
      const found = channels.find((v) => v.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      found.updatedAt = nowIso();
      return found;
    },

    async deleteChannel(id) {
      const idx = channels.findIndex((v) => v.id === id);
      if (idx < 0) return false;
      channels.splice(idx, 1);
      return true;
    },

    async testChannel(id) {
      const found = channels.find((v) => v.id === id);
      if (!found) return null;
      found.status = "connected";
      found.testedAt = nowIso();
      found.updatedAt = nowIso();
      return found;
    },

    async listAutomations(args) {
      const filtered = automations.filter((v) => {
        if (args.type && v.type !== args.type) return false;
        if (args.enabled === "true" && !v.enabled) return false;
        if (args.enabled === "false" && v.enabled) return false;
        return true;
      });
      filtered.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
      return paginate(filtered, args.page, args.pageSize);
    },

    async getAutomationById(id) {
      return automations.find((v) => v.id === id) || null;
    },

    async createAutomation(input) {
      const ts = nowIso();
      const rule: AutomationRuleRecord = {
        id: makeId("rule"),
        name: input.name,
        type: input.type,
        trigger: input.trigger,
        actions: input.actions,
        enabled: input.enabled ?? true,
        createdAt: ts,
        updatedAt: ts,
      };
      automations.push(rule);
      return rule;
    },

    async updateAutomation(id, patch) {
      const found = automations.find((v) => v.id === id);
      if (!found) return null;
      Object.assign(found, patch);
      found.updatedAt = nowIso();
      return found;
    },

    async deleteAutomation(id) {
      const idx = automations.findIndex((v) => v.id === id);
      if (idx < 0) return false;
      automations.splice(idx, 1);
      return true;
    },

    async getAnalyticsSummary() {
      const totalMessages = messages.length;
      const totalCustomers = customers.length;
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
      return buildDailySeries(messages.map((v) => v.createdAt), days);
    },

    async listIntegrations() {
      return [...integrations];
    },

    async getIntegrationById(id) {
      return integrations.find((v) => v.id === id) || null;
    },

    async syncIntegration(id) {
      const found = integrations.find((v) => v.id === id);
      if (!found) return null;
      const ts = nowIso();
      found.status = "synced";
      found.syncedAt = ts;
      found.updatedAt = ts;
      return found;
    },
  };
}



