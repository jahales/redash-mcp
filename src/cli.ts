#!/usr/bin/env node

// Initialize telemetry before importing Axios and the MCP server.
const { runConfiguredServerCli } = await import('./startup.js');
await runConfiguredServerCli();
