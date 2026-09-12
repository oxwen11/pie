/**
 * Vendored from @earendil-works/pi-coding-agent v0.85.1
 * (`packages/coding-agent/src/core/output-guard.ts`).
 * RPC JSONL must own stdout; agent console noise is redirected to stderr.
 */

interface StdoutTakeoverState {
  rawStdoutWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  rawStderrWrite: (chunk: string, callback?: (error?: Error | null) => void) => boolean;
  originalStdoutWrite: typeof process.stdout.write;
}

interface StdoutTakeover {
  state: StdoutTakeoverState | undefined;
}

interface RawStdoutWrites {
  tail: Promise<void>;
}

const stdoutTakeover: StdoutTakeover = { state: undefined };

const RAW_STDOUT_RETRY_DELAY_MS = 10;

const rawStdoutWrites: RawStdoutWrites = { tail: Promise.resolve() };

function getRawStdoutWrite(): StdoutTakeoverState["rawStdoutWrite"] {
  if (stdoutTakeover.state) {
    return stdoutTakeover.state.rawStdoutWrite;
  }
  return process.stdout.write.bind(process.stdout) as StdoutTakeoverState["rawStdoutWrite"];
}

async function writeRawStdoutChunk(text: string): Promise<void> {
  while (true) {
    try {
      await new Promise<void>((resolve, reject) => {
        try {
          getRawStdoutWrite()(text, (error) => {
            if (error) reject(error);
            else resolve();
          });
        } catch (error) {
          reject(error instanceof Error ? error : new Error(String(error)));
        }
      });
      return;
    } catch (error) {
      const writeError = error instanceof Error ? error : new Error(String(error));
      const code = (writeError as Error & { code?: unknown }).code;
      if (code !== "ENOBUFS" && code !== "EAGAIN" && code !== "EWOULDBLOCK") {
        throw writeError;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, RAW_STDOUT_RETRY_DELAY_MS);
      });
    }
  }
}

export function takeOverStdout(): void {
  if (stdoutTakeover.state) {
    return;
  }

  const rawStdoutWrite = process.stdout.write.bind(
    process.stdout,
  ) as StdoutTakeoverState["rawStdoutWrite"];
  const rawStderrWrite = process.stderr.write.bind(
    process.stderr,
  ) as StdoutTakeoverState["rawStderrWrite"];
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);

  process.stdout.write = ((
    chunk: string | Uint8Array,
    encodingOrCallback?: BufferEncoding | ((error?: Error | null) => void),
    callback?: (error?: Error | null) => void,
  ): boolean => {
    if (typeof encodingOrCallback === "function") {
      return rawStderrWrite(String(chunk), encodingOrCallback);
    }
    return rawStderrWrite(String(chunk), callback);
  }) as typeof process.stdout.write;

  stdoutTakeover.state = {
    rawStdoutWrite,
    rawStderrWrite,
    originalStdoutWrite,
  };
}

export function restoreStdout(): void {
  if (!stdoutTakeover.state) {
    return;
  }

  process.stdout.write = stdoutTakeover.state.originalStdoutWrite;
  stdoutTakeover.state = undefined;
}

export function isStdoutTakenOver(): boolean {
  return stdoutTakeover.state !== undefined;
}

export function writeRawStdout(text: string): void {
  if (text.length === 0) {
    return;
  }
  rawStdoutWrites.tail = rawStdoutWrites.tail.then(() => writeRawStdoutChunk(text));
  void rawStdoutWrites.tail.catch(() => {
    process.exitCode = 1;
  });
}

export async function waitForRawStdoutBackpressure(): Promise<void> {
  while (true) {
    const tail = rawStdoutWrites.tail;
    await tail;
    if (tail === rawStdoutWrites.tail) {
      return;
    }
  }
}

export async function flushRawStdout(): Promise<void> {
  await waitForRawStdoutBackpressure();
  await writeRawStdoutChunk("");
}
