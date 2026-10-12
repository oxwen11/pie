import { Schema } from "effect";

/** Wire vocabulary between a Pie daemon and a Hub (docs/rfc/pie-hub.md, section 5). */

export const HUB_PROTOCOL_VERSION = 1;

/** Application close code: Hub rejected or revoked this Environment; do not reconnect. */
export const HUB_CLOSE_REVOKED = 4403;

const HubIdentifierSchema = Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_.-]{0,63}$/));

export const HubEventSchema = Schema.Struct({
  version: Schema.Literal(HUB_PROTOCOL_VERSION),
  /** `<source>:<vendor delivery id>`; stable across Hub restarts. */
  eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  source: HubIdentifierSchema,
  /** The vendor's own event name, plus its action when it has one: `issue_comment.created`. */
  type: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
  /** The webhook it arrived on; absent for events injected through Hub's own API. */
  webhookId: Schema.optionalKey(Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(64))),
  /** Timezone-aware ISO-8601 instants set by Hub. */
  receivedAt: Schema.String.check(Schema.isMaxLength(40)),
  expiresAt: Schema.String.check(Schema.isMaxLength(40)),
  /** The vendor's JSON, unchanged. Size is bounded by Hub's event size limit, not here. */
  payload: Schema.Unknown,
});
export type HubEvent = typeof HubEventSchema.Type;

/** Daemon to Hub, first frame after the socket opens. */
export const HubHelloFrameSchema = Schema.Struct({
  type: Schema.Literal("hub.hello"),
  protocol: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
  environmentId: Schema.String.check(Schema.isUUID()),
  /** Optional features the daemon understands; later additions are optional-only. */
  features: Schema.optionalKey(Schema.Array(HubIdentifierSchema).check(Schema.isMaxLength(32))),
});
export type HubHelloFrame = typeof HubHelloFrameSchema.Type;

/** Hub to daemon, after a hello Hub accepted: the enrollment is active. */
export const HubWelcomeFrameSchema = Schema.Struct({
  type: Schema.Literal("hub.welcome"),
  protocol: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});
export type HubWelcomeFrame = typeof HubWelcomeFrameSchema.Type;

/** Hub to daemon. `deliveryAttempt` counts sends of this event, starting at 1. */
export const HubEventDeliverFrameSchema = Schema.Struct({
  type: Schema.Literal("hub.event.deliver"),
  event: HubEventSchema,
  deliveryAttempt: Schema.Number.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(1)),
});
export type HubEventDeliverFrame = typeof HubEventDeliverFrameSchema.Type;

/** Daemon to Hub. A rejection carries a stable code and nothing else. */
export const HubEventAckFrameSchema = Schema.Union([
  Schema.Struct({
    type: Schema.Literal("hub.event.ack"),
    eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    status: Schema.Literals(["accepted", "duplicate"]),
  }),
  Schema.Struct({
    type: Schema.Literal("hub.event.ack"),
    eventId: Schema.String.check(Schema.isMinLength(1), Schema.isMaxLength(200)),
    status: Schema.Literal("rejected"),
    code: Schema.String.check(Schema.isPattern(/^[a-z][a-z0-9_]{0,63}$/)),
  }),
]);
export type HubEventAckFrame = typeof HubEventAckFrameSchema.Type;

export const HubPingFrameSchema = Schema.Struct({ type: Schema.Literal("hub.ping") });
export const HubPongFrameSchema = Schema.Struct({ type: Schema.Literal("hub.pong") });

/** Frames Hub sends. */
export const HubServerFrameSchema = Schema.Union([
  HubWelcomeFrameSchema,
  HubEventDeliverFrameSchema,
  HubPingFrameSchema,
]);
export type HubServerFrame = typeof HubServerFrameSchema.Type;

/** Frames the daemon sends. */
export const HubDaemonFrameSchema = Schema.Union([
  HubHelloFrameSchema,
  HubEventAckFrameSchema,
  HubPongFrameSchema,
]);
export type HubDaemonFrame = typeof HubDaemonFrameSchema.Type;
