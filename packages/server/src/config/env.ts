import { Config, Option, type LogLevel } from "effect";

const LOG_LEVELS = {
  DEBUG: "Debug",
  INFO: "Info",
  WARN: "Warn",
  ERROR: "Error",
} as const satisfies Record<string, LogLevel.LogLevel>;

const splitCsv = (raw: string): string[] =>
  raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

export const pieAuthToken = Config.redacted("PIE_AUTH_TOKEN").pipe(Config.option);

export const piePort = Config.int("PIE_PORT").pipe(Config.option);

export const nodeEnv = Config.string("NODE_ENV").pipe(Config.withDefault(""));

export const pieCorsOrigins = Config.string("PIE_CORS_ORIGINS").pipe(
  Config.withDefault(""),
  Config.map(splitCsv),
);

export const pieAllowedHosts = Config.string("PIE_ALLOWED_HOSTS").pipe(
  Config.withDefault(""),
  Config.map(splitCsv),
);

export const pieHost = Config.string("PIE_HOST").pipe(Config.option);

export const pieDaemonCompatibilityKey = Config.string("PIE_DAEMON_COMPATIBILITY_KEY").pipe(
  Config.option,
);

export const npmPackageVersion = Config.string("npm_package_version").pipe(Config.option);

export const pieLogLevel = Config.string("PIE_LOG_LEVEL").pipe(
  Config.withDefault("INFO"),
  Config.map((value) => {
    const level = value.toUpperCase();
    return level === "DEBUG" || level === "INFO" || level === "WARN" || level === "ERROR"
      ? LOG_LEVELS[level]
      : "Info";
  }),
);

export const piePrintLogs = Config.boolean("PIE_PRINT_LOGS").pipe(Config.withDefault(false));

export const optionString = (value: Option.Option<string>): string | undefined =>
  Option.getOrUndefined(value);
