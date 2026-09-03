import { Config, Context, Option, type LogLevel } from "effect";

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

export const pieDaemonCompatibilityKey = Config.string("PIE_DAEMON_COMPATIBILITY_KEY").pipe(
  Config.option,
);

export const npmPackageVersion = Config.string("npm_package_version").pipe(Config.option);

export const pieLogLevel = Config.string("PIE_LOG_LEVEL").pipe(
  Config.withDefault("INFO"),
  Config.map((value) => LOG_LEVELS[value.toUpperCase() as keyof typeof LOG_LEVELS] ?? "Info"),
);

export const piePrintLogs = Config.boolean("PIE_PRINT_LOGS").pipe(Config.withDefault(false));

export const pieE2e = Config.string("PIE_E2E").pipe(Config.withDefault(""));

export const piePiExecutable = Config.string("PIE_PI_EXECUTABLE").pipe(Config.option);

export const pieE2ePiExecutable = Config.string("PIE_E2E_PI_EXECUTABLE").pipe(Config.option);

/** Default-off stderr log mirror. Bound at the observability composition root. */
export const PrintLogs = Context.Reference<boolean>("pie/PrintLogs", {
  defaultValue: () => false,
});

export const optionString = (value: Option.Option<string>): string | undefined =>
  Option.getOrUndefined(value);
