const INDEX_PLAN = {
  users: [
    { key: { id: 1 }, name: "users_id_unique", unique: true },
    { key: { username: 1 }, name: "users_username_unique", unique: true },
    { key: { email: 1 }, name: "users_email_unique", unique: true },
  ],
  customers: [
    { key: { id: 1 }, name: "customers_id_unique", unique: true },
    { key: { email: 1 }, name: "customers_email_idx", sparse: true },
    { key: { tags: 1 }, name: "customers_tags_idx" },
    { key: { segments: 1 }, name: "customers_segments_idx" },
  ],
  messages: [
    { key: { id: 1 }, name: "messages_id_unique", unique: true },
    { key: { customerId: 1, createdAt: -1 }, name: "messages_customer_created_idx" },
    { key: { status: 1, assignedTo: 1 }, name: "messages_status_assigned_idx" },
    { key: { channel: 1, createdAt: -1 }, name: "messages_channel_created_idx" },
  ],
  conversations: [
    { key: { customerId: 1, status: 1 }, name: "conv_customer_status_idx" },
    { key: { lastMessageAt: -1 }, name: "conv_last_message_idx" },
  ],
  ecommerceConnections: [
    { key: { platform: 1, userId: 1 }, name: "ecom_platform_user_idx" },
    { key: { status: 1 }, name: "ecom_status_idx" },
  ],
};

const INDEX_NAMES = Object.fromEntries(
  Object.entries(INDEX_PLAN).map(([collection, specs]) => [collection, specs.map((spec) => spec.name)]),
);

module.exports = {
  INDEX_PLAN,
  INDEX_NAMES,
};
