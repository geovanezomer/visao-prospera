// ============================================================================
// Esquema do banco (PostgreSQL 17) — fonte única, via Drizzle ORM.
//
// Substitui as migrations do Supabase. Mudanças em relação ao esquema antigo:
//   - Login: tabelas do Better Auth (user/session/account/verification) no
//     lugar de auth.users. `profiles`, `user_emails` e `user_roles` deixam de
//     existir: nome, e-mail e papel moram em `user`.
//   - Flags de trial e `ai_enabled` viram colunas de `user`, gravadas só
//     pelo servidor (antes ficavam em user_metadata, editável pelo usuário).
//   - Arquivos (buckets do Supabase Storage) viram colunas jsonb:
//     `shared_reports.payload` e a tabela `cloud_backups`.
//   - Sem RLS: o navegador não fala com o banco; toda autorização é feita
//     no servidor.
//
// Gerar migration após alterar: bun run db:generate
// ============================================================================
import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  customType,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

/**
 * timestamptz lido como texto ISO 8601 ("2026-10-06T02:13:11.935Z") — o mesmo
 * formato que o Supabase devolvia, para o código de domínio não mudar.
 * Aceita ISO ou Date na escrita.
 */
const isoTimestamp = customType<{ data: string; driverData: string | Date }>({
  dataType: () => "timestamp with time zone",
  fromDriver: (v) => new Date(v).toISOString(),
  toDriver: (v) => v,
});
const ts = (name: string) => isoTimestamp(name);
const createdAt = () => ts("created_at").notNull().default(sql`now()`);
const updatedAt = () => ts("updated_at").notNull().default(sql`now()`);

// ---------------------------------------------------------------------------
// Login (Better Auth). Nomes de coluna em snake_case; o adapter mapeia.
// ---------------------------------------------------------------------------
export const user = pgTable("user", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  // plugin username (login "admin" sem e-mail)
  username: text("username").unique(),
  displayUsername: text("display_username"),
  // plugin admin
  role: text("role").notNull().default("user"),
  banned: boolean("banned").default(false),
  banReason: text("ban_reason"),
  banExpires: timestamp("ban_expires", { withTimezone: true }),
  // campos do app (gravados só pelo servidor)
  aiEnabled: boolean("ai_enabled").notNull().default(true),
  isTrial: boolean("is_trial").notNull().default(false),
  trialExpiresAt: timestamp("trial_expires_at", { withTimezone: true }),
  trialConvertedAt: timestamp("trial_converted_at", { withTimezone: true }),
  trialConvertedPlan: text("trial_converted_plan"),
  /** Conta criada com senha provisória (ex.: admin/admin do seed). */
  mustChangePassword: boolean("must_change_password").notNull().default(false),
});

export const session = pgTable(
  "session",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    impersonatedBy: uuid("impersonated_by"),
  },
  (t) => [index("session_user_idx").on(t.userId)],
);

export const account = pgTable(
  "account",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("account_user_idx").on(t.userId)],
);

export const verification = pgTable(
  "verification",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("verification_identifier_idx").on(t.identifier)],
);

// ---------------------------------------------------------------------------
// Assinaturas e pagamentos
// ---------------------------------------------------------------------------
export const subscriptions = pgTable(
  "subscriptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    provider: text("provider").notNull().default("stripe"),
    providerCustomerId: text("provider_customer_id"),
    stripeCustomerId: text("stripe_customer_id"),
    stripeSubscriptionId: text("stripe_subscription_id").unique(),
    priceId: text("price_id").notNull(),
    plan: text("plan").notNull(),
    status: text("status").notNull(),
    currentPeriodEnd: ts("current_period_end"),
    cancelAtPeriodEnd: boolean("cancel_at_period_end").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    check("subscriptions_provider_check", sql`${t.provider} in ('stripe','asaas')`),
    index("idx_subscriptions_user_status_created").on(t.userId, t.status, t.createdAt.desc()),
    index("idx_subscriptions_provider_customer").on(t.provider, t.providerCustomerId),
  ],
);

export const plans = pgTable(
  "plans",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    slug: text("slug").notNull().unique(),
    name: text("name").notNull(),
    description: text("description"),
    priceCents: integer("price_cents").notNull().default(0),
    currency: text("currency").notNull().default("brl"),
    interval: text("interval").notNull().default("month"),
    features: jsonb("features").notNull().default([]),
    limits: jsonb("limits").notNull().default({}),
    stripePriceId: text("stripe_price_id"),
    asaasPlanRef: text("asaas_plan_ref"),
    active: boolean("active").notNull().default(true),
    sortOrder: integer("sort_order").notNull().default(0),
    upsellEnabled: boolean("upsell_enabled").notNull().default(false),
    upsellName: text("upsell_name"),
    upsellDescription: text("upsell_description"),
    upsellPriceCents: integer("upsell_price_cents").notNull().default(0),
    upsellStripePriceId: text("upsell_stripe_price_id"),
    upsellAsaasRef: text("upsell_asaas_ref"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [index("idx_plans_active_sort").on(t.sortOrder).where(sql`${t.active} = true`)],
);

export const checkoutIntents = pgTable(
  "checkout_intents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    planSlug: text("plan_slug").notNull(),
    email: text("email").notNull(),
    withUpsell: boolean("with_upsell").notNull().default(false),
    provider: text("provider").notNull(),
    planAmountCents: integer("plan_amount_cents"),
    upsellAmountCents: integer("upsell_amount_cents"),
    currency: text("currency"),
    ip: text("ip"),
    userAgent: text("user_agent"),
    idempotencyKey: text("idempotency_key"),
    status: text("status").notNull().default("created"),
    checkoutUrl: text("checkout_url"),
    providerSessionId: text("provider_session_id"),
    providerCustomerId: text("provider_customer_id"),
    providerSubscriptionId: text("provider_subscription_id"),
    paymentMethod: text("payment_method"),
    confirmedAt: ts("confirmed_at"),
    lastError: text("last_error"),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    uniqueIndex("checkout_intents_idem_key")
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
    index("checkout_intents_email_status_idx").on(sql`lower(${t.email})`, t.status),
    index("checkout_intents_created_idx").on(t.createdAt.desc()),
    index("checkout_intents_provider_sub_idx")
      .on(t.provider, t.providerSubscriptionId)
      .where(sql`${t.providerSubscriptionId} is not null`),
    index("checkout_intents_provider_cus_idx")
      .on(t.provider, t.providerCustomerId)
      .where(sql`${t.providerCustomerId} is not null`),
  ],
);

export const providerCredentials = pgTable(
  "provider_credentials",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull().unique(),
    mode: text("mode").notNull().default("test"),
    apiKey: text("api_key"),
    webhookSecret: text("webhook_secret"),
    isActive: boolean("is_active").notNull().default(false),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check("provider_credentials_provider_check", sql`${t.provider} in ('stripe','asaas')`),
    check("provider_credentials_mode_check", sql`${t.mode} in ('test','live')`),
    uniqueIndex("provider_credentials_only_one_active")
      .on(t.isActive)
      .where(sql`${t.isActive} = true`),
  ],
);

export const webhookEvents = pgTable(
  "webhook_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    provider: text("provider").notNull(),
    providerEventId: text("provider_event_id"),
    eventType: text("event_type").notNull(),
    subscriptionId: text("subscription_id"),
    customerEmail: text("customer_email"),
    status: text("status").notNull().default("processed"),
    payload: jsonb("payload").notNull().default({}),
    error: text("error"),
    attempts: integer("attempts").notNull().default(0),
    lastAttemptAt: ts("last_attempt_at"),
    nextAttemptAt: ts("next_attempt_at"),
    attemptHistory: jsonb("attempt_history").notNull().default([]),
    replayedAt: ts("replayed_at"),
    replayedBy: uuid("replayed_by"),
    lockedAt: ts("locked_at"),
    receivedAt: ts("received_at").notNull().default(sql`now()`),
  },
  (t) => [
    check("webhook_events_provider_check", sql`${t.provider} in ('stripe','asaas','admin')`),
    check(
      "webhook_events_status_check",
      sql`${t.status} in ('processed','failed','skipped','replayed','pending_retry','dead_letter')`,
    ),
    uniqueIndex("webhook_events_provider_event_unique")
      .on(t.provider, t.providerEventId)
      .where(sql`${t.providerEventId} is not null`),
    index("webhook_events_received_idx").on(t.receivedAt.desc()),
    index("webhook_events_email_idx").on(t.customerEmail),
    index("webhook_events_subscription_idx").on(t.subscriptionId),
    index("webhook_events_provider_status_idx").on(t.provider, t.status),
    index("webhook_events_retry_idx")
      .on(t.nextAttemptAt)
      .where(sql`${t.status} = 'pending_retry'`),
  ],
);

export const trialRequests = pgTable(
  "trial_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    email: text("email").notNull(),
    userId: uuid("user_id").references(() => user.id, { onDelete: "set null" }),
    ip: text("ip"),
    createdAt: createdAt(),
    expiresAt: ts("expires_at").notNull(),
    consumedAt: ts("consumed_at"),
  },
  // Um teste por e-mail, sem diferenciar maiúsculas (antes: citext UNIQUE).
  (t) => [uniqueIndex("trial_requests_email_unique").on(sql`lower(${t.email})`)],
);

// ---------------------------------------------------------------------------
// Configuração do sistema e painel admin
// ---------------------------------------------------------------------------
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull().default({}),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
});

export const featureFlags = pgTable(
  "feature_flags",
  {
    key: text("key").primaryKey(),
    description: text("description"),
    enabled: boolean("enabled").notNull().default(false),
    rolloutPercent: integer("rollout_percent").notNull().default(0),
    allowedEmails: text("allowed_emails").array().notNull().default(sql`'{}'::text[]`),
    allowedPlans: text("allowed_plans").array().notNull().default(sql`'{}'::text[]`),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by"),
  },
  (t) => [check("feature_flags_rollout_check", sql`${t.rolloutPercent} between 0 and 100`)],
);

export const adminAuditLog = pgTable(
  "admin_audit_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    actorId: uuid("actor_id"),
    actorEmail: text("actor_email"),
    action: text("action").notNull(),
    resource: text("resource").notNull(),
    targetId: text("target_id"),
    targetLabel: text("target_label"),
    metadata: jsonb("metadata").notNull().default({}),
    ip: text("ip"),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
  },
  (t) => [
    index("admin_audit_log_created_at_idx").on(t.createdAt.desc()),
    index("admin_audit_log_actor_idx").on(t.actorId),
    index("admin_audit_log_resource_idx").on(t.resource, t.action),
  ],
);

export const userNotes = pgTable(
  "user_notes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    authorId: uuid("author_id").references(() => user.id, { onDelete: "set null" }),
    authorEmail: text("author_email"),
    body: text("body").notNull(),
    pinned: boolean("pinned").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("idx_user_notes_user").on(t.userId, t.createdAt.desc())],
);

export const signupEvents = pgTable(
  "signup_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull(),
    email: text("email"),
    notified: boolean("notified").notNull().default(false),
    createdAt: createdAt(),
  },
  (t) => [index("idx_signup_events_created").on(t.createdAt.desc())],
);

export const notificationSettings = pgTable(
  "notification_settings",
  {
    id: integer("id").primaryKey().default(1),
    slackWebhookUrl: text("slack_webhook_url"),
    emailTo: text("email_to"),
    events: jsonb("events")
      .notNull()
      .default({ signup: true, churn: true, past_due: true, webhook_failure: true }),
    updatedAt: updatedAt(),
  },
  (t) => [check("notification_settings_singleton", sql`${t.id} = 1`)],
);

// ---------------------------------------------------------------------------
// E-mail
// ---------------------------------------------------------------------------
export const emailSettings = pgTable("email_settings", {
  id: uuid("id").primaryKey().defaultRandom(),
  resendApiKey: text("resend_api_key"),
  fromEmail: text("from_email"),
  fromName: text("from_name"),
  replyTo: text("reply_to"),
  updatedAt: updatedAt(),
  updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
});

export const EMAIL_TEMPLATE_KINDS = [
  "magic_link",
  "receipt",
  "password_reset",
  "refund",
  "welcome",
  "trial_magic_link",
  "payment_failed",
  "trial_ending",
  "subscription_canceled",
] as const;

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull().unique(),
    subject: text("subject").notNull(),
    html: text("html").notNull(),
    text: text("text"),
    enabled: boolean("enabled").notNull().default(true),
    updatedAt: updatedAt(),
    updatedBy: uuid("updated_by").references(() => user.id, { onDelete: "set null" }),
  },
  (t) => [
    check(
      "email_templates_kind_check",
      sql.raw(`kind in (${EMAIL_TEMPLATE_KINDS.map((k) => `'${k}'`).join(",")})`),
    ),
  ],
);

export const emailLog = pgTable(
  "email_log",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    kind: text("kind").notNull(),
    subscriptionId: text("subscription_id"),
    sentToHash: text("sent_to_hash").notNull(),
    sentAt: ts("sent_at").notNull().default(sql`now()`),
  },
  (t) => [index("email_log_kind_sub_sent_idx").on(t.kind, t.subscriptionId, t.sentAt.desc())],
);

export const broadcasts = pgTable("broadcasts", {
  id: uuid("id").primaryKey().defaultRandom(),
  subject: text("subject").notNull(),
  html: text("html").notNull(),
  segment: jsonb("segment").notNull().default({}),
  status: text("status").notNull().default("draft"),
  totalRecipients: integer("total_recipients").notNull().default(0),
  sentCount: integer("sent_count").notNull().default(0),
  failedCount: integer("failed_count").notNull().default(0),
  createdBy: uuid("created_by"),
  createdAt: createdAt(),
  sentAt: ts("sent_at"),
});

// ---------------------------------------------------------------------------
// Arquivos (antes: Supabase Storage)
// ---------------------------------------------------------------------------
export const sharedReports = pgTable(
  "shared_reports",
  {
    shareId: text("share_id").primaryKey(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    companyName: text("company_name").notNull(),
    payload: jsonb("payload").notNull(),
    expiresAt: ts("expires_at"),
    revokedAt: ts("revoked_at"),
    createdAt: createdAt(),
  },
  (t) => [
    index("idx_shared_reports_owner_active")
      .on(t.ownerId, t.createdAt.desc())
      .where(sql`${t.revokedAt} is null`),
  ],
);

/** Backup em nuvem dos arquivos .finnance (um por nome de arquivo e usuário). */
export const cloudBackups = pgTable(
  "cloud_backups",
  {
    userId: uuid("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    filename: text("filename").notNull(),
    content: text("content").notNull(),
    updatedAt: updatedAt(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.filename] })],
);

// ---------------------------------------------------------------------------
// Rate limit (contadores compartilhados entre processos)
// ---------------------------------------------------------------------------
export const rateLimitBuckets = pgTable(
  "rate_limit_buckets",
  {
    bucketKey: text("bucket_key").primaryKey(),
    count: integer("count").notNull().default(0),
    resetAt: ts("reset_at").notNull(),
  },
  (t) => [index("idx_rl_reset").on(t.resetAt)],
);
