export type UserRole = "admin" | "manager" | "agent";
export type MessageDirection = "inbound" | "outbound";
export type MessageStatus = "pending" | "processed" | "delivered";
export type ConversationStatus = "open" | "closed" | "pending";
export type ChannelStatus = "connected" | "disconnected" | "error";
export type AutomationType = "message" | "campaign" | "workflow";
export type IntegrationStatus = "connected" | "disconnected" | "error" | "synced";

export interface UserRecord {
  id: string;
  username: string;
  email: string;
  role: UserRole;
  passwordHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface CustomerRecord {
  id: string;
  name?: string;
  email?: string;
  phone?: string;
  tags: string[];
  segments: string[];
  profile: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
}

export interface MessageRecord {
  id: string;
  conversationId?: string;
  customerId: string;
  channel: string;
  channelId?: string;
  direction: MessageDirection;
  content: string;
  translatedContent?: string;
  status: MessageStatus;
  assignedTo?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConversationRecord {
  id: string;
  customerId: string;
  channel: string;
  channelId?: string;
  status: ConversationStatus;
  lastMessageAt: string;
  createdAt: string;
  updatedAt: string;
}

export interface ChannelRecord {
  id: string;
  type: string;
  config: Record<string, unknown>;
  status: ChannelStatus;
  testedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface AutomationRuleRecord {
  id: string;
  name: string;
  type: AutomationType;
  trigger: Record<string, unknown>;
  actions: Array<Record<string, unknown>>;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface AnalyticsSummaryRecord {
  totalMessages: number;
  totalCustomers: number;
  avgResponseMs: number;
  translationP95Ms: number;
}

export interface AnalyticsDailyMessageRecord {
  date: string;
  count: number;
}

export interface IntegrationRecord {
  id: string;
  platform: string;
  status: IntegrationStatus;
  syncedAt?: string;
  createdAt: string;
  updatedAt: string;
}

export interface Pagination {
  page: number;
  pageSize: number;
}

export interface Paginated<T> {
  items: T[];
  pagination: {
    page: number;
    pageSize: number;
    total: number;
    hasNext: boolean;
  };
}

export interface DataRepository {
  findUserByCredentials(username: string, password: string): Promise<UserRecord | null>;
  existsUserByUsernameOrEmail(username: string, email: string): Promise<boolean>;
  createUser(input: Pick<UserRecord, "username" | "email" | "passwordHash" | "role">): Promise<UserRecord>;

  listCustomers(args: Pagination & { q?: string }): Promise<Paginated<CustomerRecord>>;
  getCustomerById(id: string): Promise<CustomerRecord | null>;
  createCustomer(input: Omit<CustomerRecord, "id" | "createdAt" | "updatedAt">): Promise<CustomerRecord>;
  updateCustomer(
    id: string,
    patch: Partial<Omit<CustomerRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<CustomerRecord | null>;
  deleteCustomer(id: string): Promise<boolean>;

  listMessages(args: Pagination & { customerId?: string; status?: string; channel?: string }): Promise<Paginated<MessageRecord>>;
  getMessageById(id: string): Promise<MessageRecord | null>;
  createMessage(input: Omit<MessageRecord, "id" | "createdAt" | "updatedAt">): Promise<MessageRecord>;
  updateMessage(
    id: string,
    patch: Partial<Omit<MessageRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<MessageRecord | null>;

  listConversations(
    args: Pagination & { customerId?: string; status?: string; channel?: string },
  ): Promise<Paginated<ConversationRecord>>;
  getConversationById(id: string): Promise<ConversationRecord | null>;
  createConversation(input: Omit<ConversationRecord, "id" | "createdAt" | "updatedAt" | "lastMessageAt">): Promise<ConversationRecord>;
  updateConversation(
    id: string,
    patch: Partial<Omit<ConversationRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<ConversationRecord | null>;
  listMessagesByConversationId(conversationId: string): Promise<MessageRecord[]>;

  listChannels(): Promise<ChannelRecord[]>;
  getChannelById(id: string): Promise<ChannelRecord | null>;
  createChannel(input: Omit<ChannelRecord, "id" | "createdAt" | "updatedAt" | "status" | "testedAt">): Promise<ChannelRecord>;
  updateChannel(
    id: string,
    patch: Partial<Omit<ChannelRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<ChannelRecord | null>;
  deleteChannel(id: string): Promise<boolean>;
  testChannel(id: string): Promise<ChannelRecord | null>;

  listAutomations(args: Pagination & { enabled?: string; type?: string }): Promise<Paginated<AutomationRuleRecord>>;
  getAutomationById(id: string): Promise<AutomationRuleRecord | null>;
  createAutomation(
    input: Omit<AutomationRuleRecord, "id" | "createdAt" | "updatedAt" | "enabled"> & { enabled?: boolean },
  ): Promise<AutomationRuleRecord>;
  updateAutomation(
    id: string,
    patch: Partial<Omit<AutomationRuleRecord, "id" | "createdAt" | "updatedAt">>,
  ): Promise<AutomationRuleRecord | null>;
  deleteAutomation(id: string): Promise<boolean>;

  getAnalyticsSummary(): Promise<AnalyticsSummaryRecord>;
  getAnalyticsMessageTrend(days: number): Promise<AnalyticsDailyMessageRecord[]>;

  listIntegrations(): Promise<IntegrationRecord[]>;
  getIntegrationById(id: string): Promise<IntegrationRecord | null>;
  syncIntegration(id: string): Promise<IntegrationRecord | null>;

  close?(): Promise<void>;
}
