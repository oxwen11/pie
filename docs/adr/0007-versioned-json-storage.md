# Versioned JSON records with explicit, atomic migrations

Application records need validation and safe upgrades without coupling their
format to the app's package version. `@getpie/effect-json-store` uses integer
versions and Effect Schemas, sharing one codec behind document and collection APIs.

## Decision

- Store records as `{ version, data }`. A flat `migrations` array pairs each old
  schema with its migration; array position defines consecutive versions.
- Decode using the file's own version, validate every intermediate result, and
  persist only the final result through a sibling temporary file and rename.
  A failed migration must leave the original file intact.
- Corrupt JSON, invalid data, and newer versions fail explicitly. Do not reset
  user data or downgrade a newer file to make startup succeed.
- `makeJsonDocument` owns one cached file, required defaults, and serialized
  writes. `makeJsonCollection` owns keyed files, does not seed missing records,
  reads without a value cache, and coordinates mutations/migration per record id.
- Legacy unwrapped files require an explicit adoption schema and migration.
  Filesystem and randomness dependencies come from the caller's Effect context.
- Coordination is process-local. External ids must be validated at the consuming
  service's trust boundary; this library is not a multi-process database.

## Trade-offs

A flat migration array keeps inference local to each schema/migration pair and
avoids a builder API. Runtime validation checks migration outputs. Integer data
versions avoid semver migration keys tied to a release version. No library-owned
Context tag, file watcher, encryption layer, or automatic corrupt-data reset is
needed for these responsibilities.

The library's public API and tests live in
[`packages/effect-json-store`](../../packages/effect-json-store/).
[Settings deliberately use a different bare format](0006-bare-json-settings.md).
Public-package distribution and a Promise facade are outside this decision;
neither is required without a concrete consumer.
