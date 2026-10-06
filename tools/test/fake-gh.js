#!/usr/bin/env node

/** Isolated `gh` for app e2e so CI's authenticated CLI cannot list real PRs. */

const args = process.argv.slice(2);

if (args[0] === "api" && args[1] === "graphql") {
  process.stdout.write(JSON.stringify({ data: { viewer: { pullRequests: { nodes: [] } } } }));
  process.exit(0);
}

process.stderr.write("fake-gh: unsupported invocation\n");
process.exit(1);
