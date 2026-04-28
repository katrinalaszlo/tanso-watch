import { describe, test, expect, mock } from "bun:test";
import { sendSlackAlert } from "../../src/alerts/slack.ts";
import type { FiredAlert } from "../../src/alerts/engine.ts";

describe("Slack delivery", () => {
  test("sends correctly formatted webhook payload", async () => {
    let capturedBody: string | undefined;

    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(
      async (_url: string | URL | Request, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return new Response("ok", { status: 200 });
      },
    ) as unknown as typeof fetch;

    const alert: FiredAlert = {
      rule_id: "abc12345xyz",
      provider: "aws",
      service: null,
      amount: 1247.5,
      threshold: 1000,
      escalation_level: 2,
      services: [
        { name: "Amazon Bedrock", amount: 890 },
        { name: "EC2", amount: 234 },
        { name: "S3", amount: 123.5 },
      ],
    };

    await sendSlackAlert("https://hooks.slack.com/test", alert);

    expect(capturedBody).toBeDefined();
    const payload = JSON.parse(capturedBody!);
    expect(payload.text).toContain("[tanso-watch]");
    expect(payload.text).toContain("$1247.50/day");
    expect(payload.text).toContain("threshold: $1000/day");
    expect(payload.text).toContain("Amazon Bedrock");
    expect(payload.text).toContain("tanso ack abc12345");
    expect(payload.text).toContain("tanso alerts raise abc12345");
    expect(payload.text).toContain("Level 2");

    globalThis.fetch = originalFetch;
  });

  test("throws on non-200 response", async () => {
    const originalFetch = globalThis.fetch;
    globalThis.fetch = mock(async () => {
      return new Response("error", {
        status: 500,
        statusText: "Internal Server Error",
      });
    }) as unknown as typeof fetch;

    const alert: FiredAlert = {
      rule_id: "test123",
      provider: "aws",
      service: null,
      amount: 200,
      threshold: 100,
      escalation_level: 0,
      services: [],
    };

    expect(
      sendSlackAlert("https://hooks.slack.com/test", alert),
    ).rejects.toThrow("Slack webhook failed");

    globalThis.fetch = originalFetch;
  });
});
