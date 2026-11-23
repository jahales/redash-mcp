import { formatCachedResult } from "../cachedResults.js";
import type { RedashQueryResult } from "../redashClient.js";
import { isReadOnlyRequest } from "../readOnly.js";
import { MAX_RESPONSE_BYTES, safeJson } from "../toolOutput.js";

it("applies a configured row maximum and a UTF-8 byte maximum", () => {
  const old = process.env.REDASH_MAX_RESULTS;
  process.env.REDASH_MAX_RESULTS = "2";
  try {
    const result: RedashQueryResult = {
      id: 1, query_id: 2, data_source_id: 3, query_hash: "", query: "", runtime: 0, retrieved_at: "",
      data: {
        columns: [{ name: "text", type: "string", friendly_name: "Text" }],
        rows: [{ text: "first" }, { text: "é".repeat(MAX_RESPONSE_BYTES) }, { text: "third" }],
      },
    };
    for (const format of ["json", "csv"] as const) {
      const blocks = formatCachedResult(result, format, 10);
      expect(Buffer.byteLength(blocks.map(block => block.text).join(""), "utf8")).toBeLessThanOrEqual(MAX_RESPONSE_BYTES);
      expect(JSON.parse(blocks.at(-1)!.text)).toMatchObject({ row_count: 3, returned_rows: 1, truncated: true });
    }

    result.data.rows[1].text = "second";
    const [{ text }] = formatCachedResult(result, "json", 10);
    expect(JSON.parse(text)).toMatchObject({ row_count: 3, returned_rows: 2, truncated: true });
  } finally {
    if (old === undefined) delete process.env.REDASH_MAX_RESULTS;
    else process.env.REDASH_MAX_RESULTS = old;
  }
});

it("keeps a complete row that fits exactly at the byte limit", () => {
  const result: RedashQueryResult = {
    id: 1, query_id: 2, data_source_id: 3, query_hash: "", query: "", runtime: 0, retrieved_at: "",
    data: { columns: [{ name: "name", type: "string", friendly_name: "Name" }], rows: [{ name: "" }] },
  };
  for (const format of ["json", "csv"] as const) {
    result.data.rows[0].name = "";
    const fixed = Buffer.byteLength(formatCachedResult(result, format).map(block => block.text).join(""));
    result.data.rows[0].name = "x".repeat(MAX_RESPONSE_BYTES - fixed);
    const blocks = formatCachedResult(result, format);
    expect(Buffer.byteLength(blocks.map(block => block.text).join(""))).toBe(MAX_RESPONSE_BYTES);
    expect(JSON.parse(blocks.at(-1)!.text)).toMatchObject({ returned_rows: 1, truncated: false });
  }
});

it("redacts configured credentials and omits nested credential fields", () => {
  const old = process.env.REDASH_EXTRA_HEADERS;
  process.env.REDASH_EXTRA_HEADERS = 'X-Access=header.value';
  try {
    expect(JSON.parse(safeJson({
      nested: { api_key: "query-key", first: "header.value", second: "headerXvalue" },
    }))).toEqual({ nested: { first: "[redacted]", second: "headerXvalue" } });
  } finally {
    if (old === undefined) delete process.env.REDASH_EXTRA_HEADERS;
    else process.env.REDASH_EXTRA_HEADERS = old;
  }
});

it("permits cached retrieval and denies query submission, other resources, and URL overrides", () => {
  expect(isReadOnlyRequest("get", "/api/queries/42/results")).toBe(true);
  expect(isReadOnlyRequest("post", "/api/queries/42/results")).toBe(false);
  expect(isReadOnlyRequest("get", "/api/jobs/4")).toBe(false);
  expect(isReadOnlyRequest("get", "https://example.com/api/queries")).toBe(false);
});
