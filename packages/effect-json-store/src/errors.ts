import { Schema } from "effect";

/** Reading the file failed for a reason other than it not existing. */
export class JsonStoreReadError extends Schema.TaggedError<JsonStoreReadError>()(
  "JsonStoreReadError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** Creating the parent directory, writing the temp file, or renaming it failed. */
export class JsonStoreWriteError extends Schema.TaggedError<JsonStoreWriteError>()(
  "JsonStoreWriteError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** The file exists but is not valid JSON. Never auto-reset; the caller decides. */
export class JsonStoreParseError extends Schema.TaggedError<JsonStoreParseError>()(
  "JsonStoreParseError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** The JSON is valid but not a `{ version, data }` envelope with a positive integer version. */
export class JsonStoreFormatError extends Schema.TaggedError<JsonStoreFormatError>()(
  "JsonStoreFormatError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/**
 * The file was written by a newer version chain than this code knows.
 * Typical cause: the app was downgraded after an upgrade wrote the file.
 * The store never touches the file in this state.
 */
export class JsonStoreVersionTooNewError extends Schema.TaggedError<JsonStoreVersionTooNewError>()(
  "JsonStoreVersionTooNewError",
  {
    file: Schema.String,
    fileVersion: Schema.Number,
    latestVersion: Schema.Number,
  },
) {}

/** The data does not satisfy the schema of the version the file declares. */
export class JsonStoreDecodeError extends Schema.TaggedError<JsonStoreDecodeError>()(
  "JsonStoreDecodeError",
  {
    file: Schema.String,
    version: Schema.Number,
    cause: Schema.Defect(),
  },
) {}

/** Encoding a value with the latest schema failed before writing to disk. */
export class JsonStoreEncodeError extends Schema.TaggedError<JsonStoreEncodeError>()(
  "JsonStoreEncodeError",
  {
    file: Schema.String,
    cause: Schema.Defect(),
  },
) {}

/** A `migrate()` step threw, or produced a value that fails the next version's schema. */
export class JsonStoreMigrationError extends Schema.TaggedError<JsonStoreMigrationError>()(
  "JsonStoreMigrationError",
  {
    file: Schema.String,
    fromVersion: Schema.Number,
    toVersion: Schema.Number,
    cause: Schema.Defect(),
  },
) {}

/** Everything `make`/`load` can fail with. */
export type JsonStoreLoadError =
  | JsonStoreReadError
  | JsonStoreParseError
  | JsonStoreFormatError
  | JsonStoreVersionTooNewError
  | JsonStoreDecodeError
  | JsonStoreMigrationError
  | JsonStoreEncodeError
  | JsonStoreWriteError;

export type JsonStoreError = JsonStoreLoadError;
