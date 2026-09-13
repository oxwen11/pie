import { Schema } from "effect";

export const RESOURCE_SCHEMA_VERSION = 1;
export const MAX_RESOURCE_CONTROL_ENTRIES = 256;
export const MAX_RESOURCE_SAMPLE_ROWS = 4_096;

const nonNegativeNumber = Schema.Number.check(Schema.isFinite(), Schema.isGreaterThanOrEqualTo(0));
const positiveInteger = Schema.Int.check(Schema.isGreaterThanOrEqualTo(1));
const boundedString = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(128));
const timestamp = Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(64));

export const ResourceSourceSchema = Schema.Literals(["os", "daemon", "electron"]);
export type ResourceSource = typeof ResourceSourceSchema.Type;

export const ResourceProcessRoleSchema = Schema.Literals([
  "daemon",
  "pi",
  "pi-descendant",
  "electron-main",
  "electron-renderer",
  "electron-gpu",
  "electron-utility",
  "electron-other",
  "sidecar",
]);
export type ResourceProcessRole = typeof ResourceProcessRoleSchema.Type;

export const ProcessBirthIdentitySchema = Schema.Struct({
  value: boundedString,
  source: boundedString,
  precisionMs: positiveInteger,
});
export type ProcessBirthIdentity = typeof ProcessBirthIdentitySchema.Type;

export const ResourceProcessIdentitySchema = Schema.Struct({
  pid: positiveInteger,
  parentPid: Schema.optionalKey(positiveInteger),
  birth: Schema.optionalKey(ProcessBirthIdentitySchema),
});
export type ResourceProcessIdentity = typeof ResourceProcessIdentitySchema.Type;

export const ResourceWriterIdentitySchema = Schema.Struct({
  instanceId: Schema.String.check(Schema.isUUID()),
  process: ResourceProcessIdentitySchema,
});
export type ResourceWriterIdentity = typeof ResourceWriterIdentitySchema.Type;

export const ResourceMetricNameSchema = Schema.Literals([
  "rssBytes",
  "heapTotalBytes",
  "heapUsedBytes",
  "externalBytes",
  "arrayBuffersBytes",
  "workingSetBytes",
  "peakWorkingSetBytes",
  "privateBytes",
  "sharedBytes",
  "cpuPercent",
  "eventLoopDelay",
]);
export type ResourceMetricName = typeof ResourceMetricNameSchema.Type;

export const ResourceMetricStatusSchema = Schema.Struct({
  metric: ResourceMetricNameSchema,
  status: Schema.Literals(["unavailable", "warming-up"]),
  reason: Schema.optionalKey(boundedString),
});
export type ResourceMetricStatus = typeof ResourceMetricStatusSchema.Type;

export const ResourceMemoryMetricsSchema = Schema.Struct({
  rssBytes: Schema.optionalKey(Schema.Natural),
  heapTotalBytes: Schema.optionalKey(Schema.Natural),
  heapUsedBytes: Schema.optionalKey(Schema.Natural),
  externalBytes: Schema.optionalKey(Schema.Natural),
  arrayBuffersBytes: Schema.optionalKey(Schema.Natural),
  workingSetBytes: Schema.optionalKey(Schema.Natural),
  peakWorkingSetBytes: Schema.optionalKey(Schema.Natural),
  privateBytes: Schema.optionalKey(Schema.Natural),
  sharedBytes: Schema.optionalKey(Schema.Natural),
});
export type ResourceMemoryMetrics = typeof ResourceMemoryMetricsSchema.Type;

export const ResourceCpuMetricsSchema = Schema.Struct({
  percent: nonNegativeNumber,
  windowMs: nonNegativeNumber,
});
export type ResourceCpuMetrics = typeof ResourceCpuMetricsSchema.Type;

export const ResourceEventLoopDelaySchema = Schema.Struct({
  p50Ms: nonNegativeNumber,
  p99Ms: nonNegativeNumber,
  maxMs: nonNegativeNumber,
});
export type ResourceEventLoopDelay = typeof ResourceEventLoopDelaySchema.Type;

export const ResourceRuntimeIdentitySchema = Schema.Struct({
  name: boundedString,
  version: boundedString,
});
export type ResourceRuntimeIdentity = typeof ResourceRuntimeIdentitySchema.Type;

export const OsMetricsSchema = Schema.Struct({
  rssBytes: Schema.Natural,
  cpuPercent: Schema.optionalKey(nonNegativeNumber),
  cpuWindowMs: Schema.optionalKey(nonNegativeNumber),
});
export type OsMetrics = typeof OsMetricsSchema.Type;

export const RuntimeMetricsSchema = Schema.Struct({
  memory: Schema.optionalKey(ResourceMemoryMetricsSchema),
  cpu: Schema.optionalKey(ResourceCpuMetricsSchema),
  eventLoopDelay: Schema.optionalKey(ResourceEventLoopDelaySchema),
  runtime: Schema.optionalKey(ResourceRuntimeIdentitySchema),
});
export type RuntimeMetrics = typeof RuntimeMetricsSchema.Type;

const recordBase = {
  schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
  writer: ResourceWriterIdentitySchema,
  writtenAt: timestamp,
};
const sampleBase = {
  ...recordBase,
  sampledAt: timestamp,
  sampleSequence: Schema.Natural,
};

export const ResourceFileStartRecordSchema = Schema.Struct({
  ...recordBase,
  type: Schema.Literal("file_start"),
  source: ResourceSourceSchema,
  createdAt: timestamp,
  retentionStartAt: timestamp,
});
export type ResourceFileStartRecord = typeof ResourceFileStartRecordSchema.Type;

export const OsSampleSchema = Schema.Struct({
  process: ResourceProcessIdentitySchema,
  role: ResourceProcessRoleSchema,
  metrics: OsMetricsSchema,
  metricStatus: Schema.optionalKey(Schema.Array(ResourceMetricStatusSchema)),
});
export type OsSample = typeof OsSampleSchema.Type;

export const OsSampleRecordSchema = Schema.Struct({
  ...sampleBase,
  type: Schema.Literal("os_sample"),
  source: Schema.Literal("os"),
  rowIndex: Schema.Natural,
  ...OsSampleSchema.fields,
});
export type OsSampleRecord = typeof OsSampleRecordSchema.Type;

export const RuntimeSampleSchema = Schema.Struct({
  process: ResourceProcessIdentitySchema,
  role: ResourceProcessRoleSchema,
  metrics: RuntimeMetricsSchema,
  metricStatus: Schema.optionalKey(Schema.Array(ResourceMetricStatusSchema)),
});
export type RuntimeSample = typeof RuntimeSampleSchema.Type;

export const RuntimeSampleRecordSchema = Schema.Struct({
  ...sampleBase,
  type: Schema.Literal("runtime_sample"),
  source: Schema.Literals(["daemon", "electron"]),
  rowIndex: Schema.Natural,
  ...RuntimeSampleSchema.fields,
});
export type RuntimeSampleRecord = typeof RuntimeSampleRecordSchema.Type;

export const ResourceCoverageSchema = Schema.Literals(["complete", "partial"]);
export type ResourceCoverage = typeof ResourceCoverageSchema.Type;

const roundBase = {
  sampledAt: timestamp,
  collectionStartedAt: timestamp,
  collectionFinishedAt: timestamp,
  coverage: ResourceCoverageSchema,
};
const boundedOsSamples = Schema.Array(OsSampleSchema).check(
  Schema.isMaxLength(MAX_RESOURCE_SAMPLE_ROWS),
);
const boundedRuntimeSamples = Schema.Array(RuntimeSampleSchema).check(
  Schema.isMaxLength(MAX_RESOURCE_SAMPLE_ROWS),
);

export const ResourceSampleRoundSchema = Schema.Union([
  Schema.Struct({
    ...roundBase,
    source: Schema.Literal("os"),
    rootRevision: Schema.Natural,
    rows: boundedOsSamples,
  }),
  Schema.Struct({
    ...roundBase,
    source: Schema.Literals(["daemon", "electron"]),
    rows: boundedRuntimeSamples,
  }),
]);
export type ResourceSampleRound = typeof ResourceSampleRoundSchema.Type;

export const ResourceSampleEndRecordSchema = Schema.Struct({
  ...sampleBase,
  type: Schema.Literal("sample_end"),
  source: ResourceSourceSchema,
  expectedRows: Schema.Natural,
  collectionStartedAt: timestamp,
  collectionFinishedAt: timestamp,
  coverage: ResourceCoverageSchema,
  rootRevision: Schema.optionalKey(Schema.Natural),
  droppedRounds: Schema.Natural,
});
export type ResourceSampleEndRecord = typeof ResourceSampleEndRecordSchema.Type;

export const ResourceCollectorStatusRecordSchema = Schema.Struct({
  ...recordBase,
  type: Schema.Literal("collector_status"),
  source: ResourceSourceSchema,
  status: Schema.Literals([
    "starting",
    "waiting-for-lock",
    "available",
    "paused",
    "stopping",
    "stopped",
  ]),
  reason: Schema.optionalKey(boundedString),
  droppedRounds: Schema.Natural,
});
export type ResourceCollectorStatusRecord = typeof ResourceCollectorStatusRecordSchema.Type;

export const ResourceWriterStopRecordSchema = Schema.Struct({
  ...recordBase,
  type: Schema.Literal("writer_stop"),
  source: ResourceSourceSchema,
  droppedRounds: Schema.Natural,
});
export type ResourceWriterStopRecord = typeof ResourceWriterStopRecordSchema.Type;

export const ResourceRecordSchema = Schema.Union([
  ResourceFileStartRecordSchema,
  OsSampleRecordSchema,
  RuntimeSampleRecordSchema,
  ResourceSampleEndRecordSchema,
  ResourceCollectorStatusRecordSchema,
  ResourceWriterStopRecordSchema,
]);
export type ResourceRecord = typeof ResourceRecordSchema.Type;

export const ResourceRootSchema = Schema.Struct({
  process: ResourceProcessIdentitySchema,
  role: ResourceProcessRoleSchema,
});
export type ResourceRoot = typeof ResourceRootSchema.Type;

export const ElectronProcessRegistrationSchema = Schema.Struct({
  process: ResourceProcessIdentitySchema,
  role: Schema.Literals([
    "electron-main",
    "electron-renderer",
    "electron-gpu",
    "electron-utility",
    "electron-other",
  ]),
});
export type ElectronProcessRegistration = typeof ElectronProcessRegistrationSchema.Type;

const boundedElectronProcesses = Schema.Array(ElectronProcessRegistrationSchema).check(
  Schema.isMaxLength(MAX_RESOURCE_CONTROL_ENTRIES),
);

export const ElectronRegistrationSchema = Schema.Struct({
  schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
  instanceId: Schema.String.check(Schema.isUUID()),
  revision: Schema.Natural,
  root: ResourceProcessIdentitySchema,
  processes: boundedElectronProcesses,
});
export type ElectronRegistration = typeof ElectronRegistrationSchema.Type;

const boundedRoots = Schema.Array(ResourceRootSchema).check(
  Schema.isMaxLength(MAX_RESOURCE_CONTROL_ENTRIES),
);

export const SidecarCommandSchema = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("configure"),
    owner: ResourceProcessIdentitySchema,
    outputDirectory: Schema.String.check(Schema.isNonEmpty()).check(Schema.isMaxLength(4_096)),
    sampleIntervalMs: positiveInteger,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("replace_roots"),
    revision: Schema.Natural,
    roots: boundedRoots,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("stop"),
  }),
]);
export type SidecarCommand = typeof SidecarCommandSchema.Type;

export const SidecarEventSchema = Schema.Union([
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("ready"),
    process: ResourceProcessIdentitySchema,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("roots_applied"),
    revision: Schema.Natural,
  }),
  Schema.Struct({
    schemaVersion: Schema.Literal(RESOURCE_SCHEMA_VERSION),
    type: Schema.Literal("status"),
    status: Schema.Literals(["available", "paused", "stopping"]),
    reason: Schema.optionalKey(boundedString),
    lastSampledAt: Schema.optionalKey(timestamp),
    lastWrittenAt: Schema.optionalKey(timestamp),
    droppedRounds: Schema.Natural,
  }),
]);
export type SidecarEvent = typeof SidecarEventSchema.Type;
