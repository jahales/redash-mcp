import { once } from "node:events";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { RedashClient } from "../redashClient.js";

it("retrieves the cached result by GET and blocks execution before making a request", async () => {
  const requests: string[] = [];
  const fixture = { id: 87, data: { columns: [{ name: "name" }], rows: [{ name: "cached" }] } };
  const server = createServer((request, response) => {
    requests.push(request.method + " " + request.url);
    if (request.method === "GET" && request.url === "/api/queries/42/results") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({ query_result: fixture }));
    } else {
      response.writeHead(404).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");

  const previousUrl = process.env.REDASH_URL;
  const previousMode = process.env.REDASH_READ_ONLY;
  const { port } = server.address() as AddressInfo;
  process.env.REDASH_URL = "http://127.0.0.1:" + port;
  delete process.env.REDASH_READ_ONLY;

  try {
    const client = new RedashClient();
    await expect(client.getCachedQueryResult(42)).resolves.toEqual(fixture);
    await expect(client.getCachedQueryResult(43)).rejects.toThrow("No cached result");
    await expect(client.executeQuery(42)).rejects.toThrow("disabled in read-only mode");
    expect(requests).toEqual(["GET /api/queries/42/results", "GET /api/queries/43/results"]);
  } finally {
    if (previousUrl === undefined) delete process.env.REDASH_URL;
    else process.env.REDASH_URL = previousUrl;
    if (previousMode === undefined) delete process.env.REDASH_READ_ONLY;
    else process.env.REDASH_READ_ONLY = previousMode;
    await new Promise<void>((resolve, reject) =>
      server.close(error => error ? reject(error) : resolve()),
    );
  }
});
