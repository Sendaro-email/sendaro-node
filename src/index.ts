/**
 * Sendaro SDK: a TypeScript client for the Sendaro transactional email API.
 * Covers POST /api/emails, GET /api/emails, GET /api/emails/{id}, and
 * `verifyWebhook` for signed webhook deliveries.
 *
 * Field names follow the API. There is no batch send, attachment upload, or
 * separate schedule method.
 *
 * Published to npm as `sendaro` from
 * https://github.com/Sendaro-email/sendaro-node. The Sendaro app keeps an
 * identical copy of this file; change both together.
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const SENDARO_DEFAULT_BASE_URL = "https://sendaro.email";

/**
 * Message status from GET. `sent` is provider accept, not delivery.
 * A complaint is `complained`. A SES Reject is `rejected`, distinct from
 * a worker `failed`. The complaint customer webhook is `email.complained`.
 * A SES Reject uses `email.rejected`. A worker or provider failure uses
 * `email.failed`.
 */
export type EmailStatus =
  | "queued"
  | "sending"
  | "sent"
  | "delivered"
  | "bounced"
  | "failed"
  | "cancelled"
  | "delayed"
  | "complained"
  | "rejected";

export type EmailEventType =
  | "queued"
  | "sent"
  | "delivered"
  | "bounce"
  | "failed"
  | "reply"
  | "unsubscribe"
  | "open"
  | "click"
  | "complaint"
  | "delayed"
  | "reject";

/** Body for POST /api/emails. At least one of html or text is required by the API. */
export type SendEmailInput = {
  from: string;
  to: string;
  subject: string;
  html?: string;
  text?: string;
  reply_to?: string;
  scheduled_at?: string;
};

export type SendEmailOptions = {
  idempotencyKey?: string;
  signal?: AbortSignal;
};

/** POST /api/emails success body. Status is not included; read it with get(). */
export type EmailAccepted = {
  id: string;
  object: "email";
};

/** One row from GET /api/emails. Names are camelCase. */
export type EmailSummary = {
  id: string;
  status: EmailStatus;
  from: string | null;
  to: string | null;
  subject: string | null;
  createdAt: string;
  sentAt: string | null;
  error: string | null;
  providerMessageId: string | null;
};

export type EmailList = {
  object: "list";
  data: EmailSummary[];
};

export type EmailEvent = {
  id: string;
  type: EmailEventType;
  created_at: string;
  payload: Record<string, unknown>;
};

/** GET /api/emails/{id}. Names are snake_case. html is the stored body. */
export type Email = {
  id: string;
  object: "email";
  status: EmailStatus;
  from: string | null;
  to: string | null;
  subject: string | null;
  html: string | null;
  created_at: string;
  sent_at: string | null;
  error: string | null;
  provider_message_id: string | null;
  events: EmailEvent[];
};

export type ListEmailsQuery = {
  limit?: number;
};

export type SendaroOptions = {
  /** Defaults to the SENDARO_API_KEY environment variable. */
  apiKey?: string;
  /** Defaults to SENDARO_BASE_URL, then SENDARO_DEFAULT_BASE_URL. */
  baseUrl?: string;
};

/** Environment variable `new Sendaro()` reads the API key from. */
export const SENDARO_API_KEY_ENV = "SENDARO_API_KEY";

function readEnv(name: string): string | undefined {
  // Not every runtime has `process` (browsers, some edge runtimes).
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } })
    .process?.env;
  return env?.[name]?.trim() || undefined;
}

/** Non-2xx response. `code` is the API `error` string. `status` is the HTTP status. */
export class SendaroError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: unknown;

  constructor(status: number, code: string, details?: unknown) {
    super(code);
    this.name = "SendaroError";
    this.status = status;
    this.code = code;
    if (details !== undefined) this.details = details;
  }
}

/** Accept `rf-timestamp` this many seconds before or after `now`. */
export const WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS = 300;

function webhookTimestamp(value: string | number): number | null {
  if (typeof value === "number") {
    if (!Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }
  if (!/^[0-9]+$/.test(value)) return null;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0) return null;
  return parsed;
}

function webhookNow(now: number | undefined): number | null {
  if (now === undefined) return Math.floor(Date.now() / 1000);
  if (typeof now !== "number" || !Number.isSafeInteger(now) || now < 0) {
    return null;
  }
  return now;
}

/**
 * Verify a customer webhook.
 *
 * The server signer is `signWebhookPayload(secret, timestamp, body)`:
 * HMAC-SHA256 of `${timestamp}.${payload}`, hex-encoded, sent as
 * `rf-signature`, with the unix timestamp in `rf-timestamp`.
 * `signatureHeader` is that `rf-signature` value. `timestampHeader` is
 * the `rf-timestamp` value. Comparison matches the server: equal-length
 * digests use `timingSafeEqual`. A missing signature or timestamp is
 * rejected, including an unsigned body. A timestamp older than 5 minutes
 * (300 seconds) or more than 5 minutes ahead is rejected. `now` is unix
 * seconds and defaults to the current time; tests pass it explicitly.
 * The server stamps `Math.floor(Date.now() / 1000)` at send time, so a
 * delivery it just signed is inside this window.
 */
export function verifyWebhook(
  payload: string,
  signatureHeader: string | null | undefined,
  secret: string,
  timestampHeader?: string | number | null,
  now?: number,
): boolean {
  if (typeof payload !== "string") return false;
  if (typeof secret !== "string" || secret.length === 0) return false;
  if (signatureHeader == null || signatureHeader.length === 0) return false;
  if (timestampHeader == null || timestampHeader === "") return false;

  const timestamp = webhookTimestamp(timestampHeader);
  if (timestamp === null) return false;
  const current = webhookNow(now);
  if (current === null) return false;
  const skew = Math.abs(current - timestamp);
  if (skew > WEBHOOK_TIMESTAMP_TOLERANCE_SECONDS) return false;

  const expected = createHmac("sha256", secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  const a = Buffer.from(expected);
  const b = Buffer.from(signatureHeader);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function sendPayload(input: SendEmailInput): SendEmailInput {
  const body: SendEmailInput = {
    from: input.from,
    to: input.to,
    subject: input.subject,
  };
  if (input.html !== undefined) body.html = input.html;
  if (input.text !== undefined) body.text = input.text;
  if (input.reply_to !== undefined) body.reply_to = input.reply_to;
  if (input.scheduled_at !== undefined) body.scheduled_at = input.scheduled_at;
  return body;
}

function errorFromBody(body: unknown): { code: string; details?: unknown } {
  if (!body || typeof body !== "object" || !("error" in body)) {
    return { code: "unexpected_error" };
  }
  const record = body as { error?: unknown; details?: unknown };
  const code =
    typeof record.error === "string" && record.error.length > 0
      ? record.error
      : "unexpected_error";
  if (record.details === undefined) return { code };
  return { code, details: record.details };
}

export class Sendaro {
  readonly apiKey: string;
  readonly baseUrl: string;

  /**
   * `new Sendaro()` reads SENDARO_API_KEY from the environment.
   * `new Sendaro("rf_...")` or `new Sendaro({ apiKey, baseUrl })` set it directly.
   */
  constructor(options?: SendaroOptions | string) {
    const opts = typeof options === "string" ? { apiKey: options } : (options ?? {});
    const apiKey = opts.apiKey?.trim() || readEnv(SENDARO_API_KEY_ENV) || "";
    if (!apiKey) {
      throw new Error(
        `Missing API key. Set ${SENDARO_API_KEY_ENV} in your environment (.env) or pass it: new Sendaro("rf_...").`,
      );
    }
    const configured = opts.baseUrl?.trim() || readEnv("SENDARO_BASE_URL");
    this.apiKey = apiKey;
    this.baseUrl = (configured ? configured : SENDARO_DEFAULT_BASE_URL).replace(
      /\/+$/,
      "",
    );
  }

  /** POST /api/emails. Returns 202, or 200 when Idempotency-Key replays the same body. */
  async send(
    input: SendEmailInput,
    options?: SendEmailOptions,
  ): Promise<EmailAccepted> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (options?.idempotencyKey !== undefined) {
      headers["Idempotency-Key"] = options.idempotencyKey;
    }
    return this.request<EmailAccepted>("POST", "/api/emails", {
      headers,
      body: JSON.stringify(sendPayload(input)),
      signal: options?.signal,
    });
  }

  /** GET /api/emails/{id}. */
  async get(id: string): Promise<Email> {
    return this.request<Email>(
      "GET",
      `/api/emails/${encodeURIComponent(id)}`,
    );
  }

  /** GET /api/emails. Optional query is `limit` (the API defaults to 50 and caps at 100). */
  async list(query?: ListEmailsQuery): Promise<EmailList> {
    if (query?.limit === undefined) {
      return this.request<EmailList>("GET", "/api/emails");
    }
    const params = new URLSearchParams({ limit: String(query.limit) });
    return this.request<EmailList>("GET", `/api/emails?${params.toString()}`);
  }

  private async request<T>(
    method: "GET" | "POST",
    path: string,
    init?: { headers?: Record<string, string>; body?: string; signal?: AbortSignal },
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.apiKey}`);
    headers.set("Accept", "application/json");
    const response = await fetch(`${this.baseUrl}${path}`, {
      method,
      headers,
      body: init?.body,
      signal: init?.signal,
      redirect: "manual",
      credentials: "omit",
    });
    const text = await response.text();
    let parsed: unknown = null;
    if (text) {
      try {
        parsed = JSON.parse(text) as unknown;
      } catch {
        parsed = null;
      }
    }
    if (!response.ok) {
      const failure = errorFromBody(parsed);
      throw new SendaroError(response.status, failure.code, failure.details);
    }
    return parsed as T;
  }
}
