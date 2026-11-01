# sendaro

Official Node.js and TypeScript SDK for [Sendaro](https://sendaro.email), the transactional email API.

```bash
npm install sendaro
```

Requires Node.js 20 or later. Works with `import` and `require`.

## Quick start

1. [Create a free account](https://sendaro.email/register), verify a sending domain, and create an API key.
2. Put the key in your app's `.env`:

   ```bash
   SENDARO_API_KEY=rf_your_api_key
   ```

3. Send:

   ```ts
   import { Sendaro } from "sendaro";

   const sendaro = new Sendaro(); // reads SENDARO_API_KEY

   const { id } = await sendaro.send({
     from: "Acme <hello@updates.acme.com>",
     to: "user@example.com",
     subject: "Welcome to Acme",
     html: "<p>Thanks for signing up.</p>",
   });
   ```

The `from` address must be on a domain or sending subdomain verified in your workspace. Keep the API key on the server: never commit it or ship it in browser code.

## Creating a client

```ts
new Sendaro();                                   // SENDARO_API_KEY from the environment
new Sendaro("rf_your_api_key");                  // key passed directly
new Sendaro({ apiKey: "rf_...", baseUrl: "..." }); // both options
```

`baseUrl` defaults to `SENDARO_BASE_URL`, then `https://sendaro.email`. A missing key throws an error that says how to set it.

## Sending

```ts
await sendaro.send(
  {
    from: "hello@updates.acme.com",
    to: "user@example.com",
    subject: "Your receipt",
    html: "<p>Thanks for your order.</p>",
    text: "Thanks for your order.",       // optional plain-text part
    reply_to: "support@acme.com",          // optional
    scheduled_at: "2026-11-01T09:00:00Z",  // optional
  },
  { idempotencyKey: "order-1234-receipt" },
);
```

At least one of `html` or `text` is required. `send` resolves when the message is queued, with `{ id, object: "email" }`. It does not mean the message was delivered.

**Idempotency:** the same `idempotencyKey` with the same body returns the original id for 24 hours instead of sending twice. A different body with that key in the window throws a 409 error.

## Unsubscribe links

For newsletters and other bulk mail, pass `unsubscribe: true`. Sendaro adds one-click `List-Unsubscribe` headers and replaces `{{unsubscribe_url}}` in your `html` or `text` with a hosted unsubscribe link:

```ts
await sendaro.send({
  from: "Acme <news@updates.acme.com>",
  to: "user@example.com",
  subject: "What's new in November",
  html: '<p>Here is what shipped.</p><a href="{{unsubscribe_url}}">Unsubscribe</a>',
  unsubscribe: true,
});
```

Someone who unsubscribes is added to your suppression list, and the `email.unsubscribed` webhook fires. To use your own unsubscribe URL instead, pass it in `headers` (`List-Unsubscribe` and `List-Unsubscribe-Post`).

## Suppression list

Sendaro never sends to a suppressed address. With an API key that has the suppression scopes, you can sync opt-outs from your own app:

```ts
await sendaro.addSuppression({ email: "user@example.com", reason: "unsubscribe" });
const { items } = await sendaro.listSuppressions({ reason: "unsubscribe" });
await sendaro.removeSuppression("user@example.com"); // only if they opted back in
```

## Reading messages

```ts
const email = await sendaro.get(id);   // status, body, and event history
const page = await sendaro.list({ limit: 50 }); // most recent, up to 100
```

`email.status` is one of `queued`, `sending`, `sent`, `delivered`, `bounced`, `failed`, `cancelled`, `delayed`, `complained`, or `rejected`. `sent` means our mail servers accepted the message. `delivered` means the recipient's mail server accepted it. See [statuses](https://sendaro.email/docs#statuses).

## Errors

A non-2xx response throws `SendaroError`:

```ts
import { SendaroError } from "sendaro";

try {
  await sendaro.send(message);
} catch (error) {
  if (error instanceof SendaroError) {
    console.error(error.status, error.code, error.details);
  }
}
```

`POST /api/emails` allows 60 requests per 60 seconds per API key and 120 per workspace. Over the limit, `send` throws a `SendaroError` with status `429` and nothing is stored, so it is safe to retry with the same `idempotencyKey`.

## Verifying webhooks

Sendaro signs webhook deliveries with your endpoint's secret. Verify the raw request body before trusting it:

```ts
import { verifyWebhook } from "sendaro";

const ok = verifyWebhook(
  rawBody,                              // the exact body string received
  request.headers.get("rf-signature"),
  process.env.SENDARO_WEBHOOK_SECRET!,
  request.headers.get("rf-timestamp"),
);
```

It returns `false` for a missing or wrong signature, a changed body, or a timestamp more than 5 minutes from now. See [webhooks](https://sendaro.email/docs#webhooks) for the events and payload.

## Links

- [Documentation](https://sendaro.email/docs)
- [Sign in](https://sendaro.email/login)
- [Source and issues](https://github.com/Sendaro-email/sendaro-node)

## License

MIT
