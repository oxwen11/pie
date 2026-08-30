// A minimal stand-in for the real server: binds the port the launcher reserved,
// answers health, authenticates ownership, and accepts graceful shutdown.
import http from "node:http";

const port = Number(process.env.PIE_PORT ?? 0);
const token = process.env.PIE_AUTH_TOKEN;
const shutdownDelayMs = Number(process.env.PIE_TEST_SHUTDOWN_DELAY_MS ?? 0);
const startupDelayMs = Number(process.env.PIE_TEST_STARTUP_DELAY_MS ?? 0);
if (shutdownDelayMs > 0) process.on("SIGTERM", () => {});

const server = http.createServer((req, res) => {
  if (req.method === "GET" && req.url === "/api/health") {
    if (process.env.PIE_TEST_LEGACY !== "1") {
      res.setHeader("x-pie-protocol-version", "2");
    }
    res.end("ok");
    return;
  }

  const authenticated = req.headers.authorization === `Bearer ${token}`;
  if (!authenticated) {
    res.statusCode = 401;
    res.end("unauthorized");
    return;
  }

  if (req.method === "POST" && req.url === "/api/ws-ticket") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ ticket: "fake-ticket" }));
    return;
  }

  if (req.method === "POST" && req.url === "/api/shutdown") {
    res.statusCode = 202;
    res.end("shutting down", () => {
      setTimeout(() => server.close(), shutdownDelayMs);
    });
    return;
  }

  res.statusCode = 404;
  res.end("nope");
});

setTimeout(() => {
  server.listen(port, "127.0.0.1", () => {
    const address = server.address();
    console.log(`pie:ready {"port":${address.port}}`);
  });
}, startupDelayMs);
