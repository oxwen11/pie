import { Exit, Schema } from "effect";
import { describe, expect, it } from "vitest";

import {
  HUB_CLOSE_REVOKED,
  HUB_PROTOCOL_VERSION,
  HubDaemonFrameSchema,
  HubEventSchema,
  HubServerFrameSchema,
} from "../src/hub";

const UUID = "0195b4b3-6dc4-7d41-a9ce-3ab5dcb6cc61";

const accepts = <A>(schema: Schema.ConstraintDecoder<A>, value: unknown): boolean =>
  Exit.isSuccess(Schema.decodeUnknownExit(schema)(value));

const event = {
  version: HUB_PROTOCOL_VERSION,
  eventId: "github:72d3162e-cc78-11e3-81ab-4c9367dc0958",
  source: "github",
  type: "issue_comment.created",
  webhookId: "wh_1",
  receivedAt: "2026-10-07T00:00:00.000Z",
  expiresAt: "2026-10-08T00:00:00.000Z",
  payload: { action: "created", comment: { body: "hi" } },
};

describe("HubEvent", () => {
  it("keeps the vendor payload as is and allows hub events without a webhook", () => {
    const { webhookId: _webhookId, ...hubEvent } = event;
    expect(accepts(HubEventSchema, event)).toBe(true);
    expect(accepts(HubEventSchema, { ...hubEvent, source: "hub" })).toBe(true);
    expect(accepts(HubEventSchema, { ...event, payload: [1, "x", null] })).toBe(true);
  });

  it("rejects an unknown version, a bad source, and an empty or oversized id", () => {
    expect(accepts(HubEventSchema, { ...event, version: 2 })).toBe(false);
    expect(accepts(HubEventSchema, { ...event, source: "GitHub" })).toBe(false);
    expect(accepts(HubEventSchema, { ...event, eventId: "" })).toBe(false);
    expect(accepts(HubEventSchema, { ...event, eventId: "x".repeat(201) })).toBe(false);
  });
});

describe("daemon frames", () => {
  it("accepts hello, ack and pong", () => {
    expect(
      accepts(HubDaemonFrameSchema, {
        type: "hub.hello",
        protocol: 1,
        environmentId: UUID,
        features: ["hold"],
      }),
    ).toBe(true);
    expect(
      accepts(HubDaemonFrameSchema, {
        type: "hub.event.ack",
        eventId: event.eventId,
        status: "accepted",
      }),
    ).toBe(true);
    expect(accepts(HubDaemonFrameSchema, { type: "hub.pong" })).toBe(true);
  });

  it("requires a stable code on a rejection and refuses one elsewhere", () => {
    const ack = { type: "hub.event.ack", eventId: event.eventId };
    expect(
      accepts(HubDaemonFrameSchema, { ...ack, status: "rejected", code: "unsupported_source" }),
    ).toBe(true);
    expect(accepts(HubDaemonFrameSchema, { ...ack, status: "rejected" })).toBe(false);
    expect(accepts(HubDaemonFrameSchema, { ...ack, status: "rejected", code: "Not Stable!" })).toBe(
      false,
    );
    expect(accepts(HubDaemonFrameSchema, { ...ack, status: "unknown" })).toBe(false);
  });

  it("rejects a hello with a non-UUID Environment or a bad protocol", () => {
    const hello = { type: "hub.hello", protocol: 1, environmentId: UUID };
    expect(accepts(HubDaemonFrameSchema, { ...hello, environmentId: "local" })).toBe(false);
    expect(accepts(HubDaemonFrameSchema, { ...hello, protocol: 0 })).toBe(false);
  });
});

describe("hub frames", () => {
  it("accepts welcome, deliver and ping", () => {
    expect(accepts(HubServerFrameSchema, { type: "hub.welcome", protocol: 1 })).toBe(true);
    expect(
      accepts(HubServerFrameSchema, { type: "hub.event.deliver", event, deliveryAttempt: 1 }),
    ).toBe(true);
    expect(accepts(HubServerFrameSchema, { type: "hub.ping" })).toBe(true);
  });

  it("rejects frames sent in the wrong direction and a zero delivery attempt", () => {
    expect(accepts(HubServerFrameSchema, { type: "hub.pong" })).toBe(false);
    expect(accepts(HubDaemonFrameSchema, { type: "hub.ping" })).toBe(false);
    expect(
      accepts(HubServerFrameSchema, { type: "hub.event.deliver", event, deliveryAttempt: 0 }),
    ).toBe(false);
  });
});

describe("close codes", () => {
  it("uses the application range for revocation", () => {
    expect(HUB_CLOSE_REVOKED).toBe(4403);
  });
});
