import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyWebhook } from "../src/index.js";

/** Same scheme the Sendaro server uses to sign webhook deliveries. */
function signWebhookPayload(secret: string, timestamp: number, body: string): string {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
}

describe("SDK verifyWebhook", () => {
  const secret = "whsec_unit_test_secret";
  const payload = JSON.stringify({
    type: "email.delivered",
    created_at: "2026-10-14T00:00:00.000Z",
    data: { id: "msg_1" },
  });
  const timestamp = 1_700_000_000;

  it("accepts a payload signed by the server and rejects a flipped byte", () => {
    const signature = signWebhookPayload(secret, timestamp, payload);

    expect(
      verifyWebhook(payload, signature, secret, String(timestamp), timestamp),
    ).toBe(true);
    expect(verifyWebhook(payload, signature, secret, timestamp, timestamp)).toBe(
      true,
    );

    const bytes = Buffer.from(payload, "utf8");
    bytes[0] = bytes[0]! ^ 0x01;
    const tampered = bytes.toString("utf8");
    expect(verifyWebhook(tampered, signature, secret, timestamp, timestamp)).toBe(
      false,
    );
    expect(
      verifyWebhook(payload, signature, "other-secret", timestamp, timestamp),
    ).toBe(false);
    expect(verifyWebhook(payload, null, secret, timestamp, timestamp)).toBe(
      false,
    );
    expect(
      verifyWebhook(payload, undefined, secret, timestamp, timestamp),
    ).toBe(false);
    expect(verifyWebhook(payload, "", secret, timestamp, timestamp)).toBe(
      false,
    );
    expect(verifyWebhook(payload, signature, secret, null, timestamp)).toBe(
      false,
    );
    expect(verifyWebhook(payload, signature, secret, undefined, timestamp)).toBe(
      false,
    );
  });

  it("rejects a valid signature outside the 5 minute window", () => {
    const fresh = 1_700_000_000;
    const signature = signWebhookPayload(secret, fresh, payload);

    expect(verifyWebhook(payload, signature, secret, fresh, fresh)).toBe(true);
    expect(
      verifyWebhook(payload, signature, secret, fresh, fresh + 5 * 60),
    ).toBe(true);
    expect(
      verifyWebhook(payload, signature, secret, fresh, fresh - 5 * 60),
    ).toBe(true);
    expect(
      verifyWebhook(payload, signature, secret, fresh, fresh + 6 * 60),
    ).toBe(false);
    expect(
      verifyWebhook(payload, signature, secret, fresh, fresh - 6 * 60),
    ).toBe(false);
    expect(
      verifyWebhook(payload, signature, secret, fresh, fresh + 5 * 60 + 1),
    ).toBe(false);

    const bytes = Buffer.from(payload, "utf8");
    bytes[0] = bytes[0]! ^ 0x01;
    expect(
      verifyWebhook(bytes.toString("utf8"), signature, secret, fresh, fresh),
    ).toBe(false);
  });
});
