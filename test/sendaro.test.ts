import { afterEach, describe, expect, it, vi } from "vitest";
import {
  SENDARO_DEFAULT_BASE_URL,
  Sendaro,
  SendaroError,
  type Email,
  type EmailAccepted,
  type EmailList,
} from "../src/index.js";

const apiKey = "rf_test_placeholder";

type Captured = {
  url: string;
  method: string;
  headers: Headers;
  body: string | undefined;
};

function installFetch(status: number, body: unknown): Captured[] {
  const calls: Captured[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({
        url: String(input),
        method: init?.method ?? "GET",
        headers: new Headers(init?.headers),
        body: typeof init?.body === "string" ? init.body : undefined,
      });
      return new Response(body === undefined ? "" : JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    }),
  );
  return calls;
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("Sendaro SDK", () => {
  it("reads SENDARO_API_KEY from the environment like other email SDKs", async () => {
    vi.stubEnv("SENDARO_API_KEY", "rf_from_env");
    const calls = installFetch(202, { id: "00000000-0000-4000-8000-000000000000", object: "email" });
    const client = new Sendaro();
    await client.send({ from: "a@b.test", to: "c@d.test", subject: "s", html: "<p>h</p>" });
    expect(calls[0]?.headers.get("authorization")).toBe("Bearer rf_from_env");
    expect(client.baseUrl).toBe(SENDARO_DEFAULT_BASE_URL);
  });

  it("accepts the key as a string and prefers an explicit key over the environment", () => {
    vi.stubEnv("SENDARO_API_KEY", "rf_from_env");
    expect(new Sendaro("rf_explicit").apiKey).toBe("rf_explicit");
    expect(new Sendaro({ apiKey: "rf_option" }).apiKey).toBe("rf_option");
  });

  it("reads SENDARO_BASE_URL when no baseUrl is passed", () => {
    vi.stubEnv("SENDARO_BASE_URL", "https://usesendaro.com/");
    expect(new Sendaro("rf_explicit").baseUrl).toBe("https://usesendaro.com");
  });

  it("explains how to set the key when it is missing", () => {
    vi.stubEnv("SENDARO_API_KEY", "");
    expect(() => new Sendaro()).toThrow(/SENDARO_API_KEY/);
  });

  it("posts the send body to the default host with a bearer key", async () => {
    const calls = installFetch(201, {
      id: "00000000-0000-4000-8000-000000000000",
      object: "email",
    } satisfies EmailAccepted);
    const client = new Sendaro({ apiKey });

    const accepted = await client.send({
      from: "you@your-verified-domain.com",
      to: "you@example.com",
      subject: "Hello from Sendaro",
      html: "<p>It works.</p>",
      text: "It works.",
      reply_to: "reply@example.com",
      scheduled_at: "2026-10-14T00:00:00Z",
    });

    expect(client.baseUrl).toBe(SENDARO_DEFAULT_BASE_URL);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.method).toBe("POST");
    expect(calls[0]?.url).toBe("https://sendaro.email/api/emails");
    expect(calls[0]?.headers.get("Authorization")).toBe(
      "Bearer rf_test_placeholder",
    );
    expect(calls[0]?.headers.get("Idempotency-Key")).toBeNull();
    expect(calls[0]?.url).not.toContain(apiKey);
    expect(JSON.parse(calls[0]?.body ?? "")).toEqual({
      from: "you@your-verified-domain.com",
      to: "you@example.com",
      subject: "Hello from Sendaro",
      html: "<p>It works.</p>",
      text: "It works.",
      reply_to: "reply@example.com",
      scheduled_at: "2026-10-14T00:00:00Z",
    });
    expect(accepted).toEqual({
      id: "00000000-0000-4000-8000-000000000000",
      object: "email",
    });
  });

  it("sends Idempotency-Key only when the caller provides one", async () => {
    const calls = installFetch(200, {
      id: "replayed",
      object: "email",
    } satisfies EmailAccepted);
    const client = new Sendaro({
      apiKey,
      baseUrl: "https://usesendaro.com/",
    });

    const accepted = await client.send(
      {
        from: "you@your-verified-domain.com",
        to: "you@example.com",
        subject: "Hello",
        html: "<p>Hi</p>",
      },
      { idempotencyKey: "first-send-1" },
    );

    expect(calls[0]?.url).toBe("https://usesendaro.com/api/emails");
    expect(calls[0]?.headers.get("Idempotency-Key")).toBe("first-send-1");
    expect(calls[0]?.headers.get("Authorization")).toBe(
      "Bearer rf_test_placeholder",
    );
    const parsed = JSON.parse(calls[0]?.body ?? "") as Record<string, unknown>;
    expect(parsed).not.toHaveProperty("text");
    expect(parsed).not.toHaveProperty("reply_to");
    expect(parsed).not.toHaveProperty("scheduled_at");
    expect(parsed).not.toHaveProperty("attachments");
    expect(accepted.object).toBe("email");
  });

  it("passes the caller's abort signal to the send request", async () => {
    const fetch = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.signal).toBe(controller.signal);
      return Response.json({ id: "email-id", object: "email" });
    });
    const controller = new AbortController();
    vi.stubGlobal("fetch", fetch);
    await new Sendaro({ apiKey }).send(
      { from: "sender@example.com", to: "recipient@example.com", subject: "Hello", text: "Hi" },
      { signal: controller.signal },
    );
    expect(fetch).toHaveBeenCalledOnce();
  });

  it("reads one message with the snake_case fields GET returns", async () => {
    const detail = {
      id: "msg_1",
      object: "email",
      status: "sent",
      from: "you@your-verified-domain.com",
      to: "you@example.com",
      subject: "Hello",
      html: "<p>It works.</p>",
      created_at: "2026-10-14T00:00:00.000Z",
      sent_at: "2026-10-14T00:00:01.000Z",
      error: null,
      provider_message_id: "ses-1",
      events: [
        {
          id: "evt_1",
          type: "sent",
          created_at: "2026-10-14T00:00:01.000Z",
          payload: { source: "test" },
        },
      ],
    } satisfies Email;
    const calls = installFetch(200, detail);
    const client = new Sendaro({ apiKey });

    const message = await client.get("msg/1");

    expect(calls[0]?.method).toBe("GET");
    expect(calls[0]?.url).toBe("https://sendaro.email/api/emails/msg%2F1");
    expect(calls[0]?.headers.get("Authorization")).toBe(
      "Bearer rf_test_placeholder",
    );
    expect(calls[0]?.body).toBeUndefined();
    expect(message.provider_message_id).toBe("ses-1");
    expect(message.events[0]?.created_at).toBe("2026-10-14T00:00:01.000Z");
    expect(message).not.toHaveProperty("createdAt");
  });

  it("lists with camelCase rows and an optional limit query", async () => {
    const page = {
      object: "list",
      data: [
        {
          id: "msg_1",
          status: "queued",
          from: "you@your-verified-domain.com",
          to: "you@example.com",
          subject: "Hello",
          createdAt: "2026-10-14T00:00:00.000Z",
          sentAt: null,
          error: null,
          providerMessageId: null,
        },
      ],
    } satisfies EmailList;
    const calls = installFetch(200, page);
    const client = new Sendaro({ apiKey });

    const all = await client.list();
    const limited = await client.list({ limit: 10 });

    expect(calls[0]?.url).toBe("https://sendaro.email/api/emails");
    expect(calls[1]?.url).toBe("https://sendaro.email/api/emails?limit=10");
    expect(calls[0]?.headers.get("Authorization")).toBe(
      "Bearer rf_test_placeholder",
    );
    expect(all.object).toBe("list");
    expect(limited.data[0]?.providerMessageId).toBeNull();
    expect(limited.data[0]?.createdAt).toBe("2026-10-14T00:00:00.000Z");
    expect(limited.data[0]).not.toHaveProperty("created_at");
  });

  it("throws SendaroError with the API error string and status", async () => {
    installFetch(409, {
      error: "Idempotency key was already used with a different request body",
    });
    const client = new Sendaro({ apiKey });

    const conflict = client.send(
      {
        from: "you@your-verified-domain.com",
        to: "you@example.com",
        subject: "Hello",
        text: "plain",
      },
      { idempotencyKey: "first-send-1" },
    );

    await expect(conflict).rejects.toBeInstanceOf(SendaroError);
    await expect(conflict).rejects.toMatchObject({
      status: 409,
      code: "Idempotency key was already used with a different request body",
    });
  });

  it("keeps validation details on the typed error", async () => {
    installFetch(400, {
      error: "validation_error",
      details: { message: "html or text is required" },
    });
    const client = new Sendaro({ apiKey });

    await expect(
      client.send({
        from: "you@your-verified-domain.com",
        to: "you@example.com",
        subject: "Hello",
      }),
    ).rejects.toMatchObject({
      name: "SendaroError",
      status: 400,
      code: "validation_error",
      details: { message: "html or text is required" },
    });
  });

  it("uses unexpected_error when the error body is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("nope", { status: 502 })),
    );
    const client = new Sendaro({ apiKey });

    await expect(client.get("missing")).rejects.toMatchObject({
      status: 502,
      code: "unexpected_error",
    });
  });
});
