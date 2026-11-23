import type { RedashQueryResult } from "./redashClient.js";
import { MAX_RESPONSE_BYTES, isSensitiveField, maxRows, safeJson, secretRedactor } from "./toolOutput.js";

type OutputFormat = "json" | "csv";
const byteLength = (text: string) => Buffer.byteLength(text, "utf8");

export function formatCachedResult(result: RedashQueryResult, format: OutputFormat, requestedMaxRows?: number) {
  const { rows, columns } = result.data;
  const limit = maxRows(requestedMaxRows);
  const redact = secretRedactor();
  const visibleColumns = columns.filter(({ name }) => !isSensitiveField(name) && redact(name) === name);
  const entries: string[] = [];
  const summary = (count: number) => safeJson({
    query_result_id: result.id,
    retrieved_at: result.retrieved_at,
    row_count: rows.length,
    returned_rows: count,
    truncated: count < rows.length,
  });

  const separator = format === "csv" ? "\r\n" : ",";
  const header = format === "csv" ? visibleColumns.map(column => csvCell(column.name)).join(",") : "";
  const jsonDataPrefix = format === "json" ? ',"data":{"columns":' + safeJson(visibleColumns) + ',"rows":[' : "";
  const jsonSuffix = "]}}";
  const fixedBytes = (count: number) => format === "csv"
    ? byteLength(header) + byteLength(summary(count))
    : byteLength(summary(count)) - 1 + byteLength(jsonDataPrefix) + byteLength(jsonSuffix);

  if (fixedBytes(0) > MAX_RESPONSE_BYTES) throw new Error("The result columns exceed the response size limit.");

  // Budget the metadata for the candidate row count and keep only whole records.
  let rowBytes = 0;
  for (let index = 0; index < Math.min(rows.length, limit); index++) {
    const row = rows[index];
    const values = visibleColumns.map(({ name }) => [name, Object.hasOwn(row, name) ? row[name] : undefined] as const);
    const entry = format === "csv"
      ? values.map(([, value]) => csvCell(
          value !== null && typeof value === "object" ? safeJson(value) : redact(String(value ?? "")),
        )).join(",")
      : safeJson(Object.fromEntries(values));
    const entryBytes = byteLength(entry) + (format === "csv" || entries.length ? byteLength(separator) : 0);

    if (fixedBytes(entries.length + 1) + rowBytes + entryBytes > MAX_RESPONSE_BYTES) break;
    entries.push(entry);
    rowBytes += entryBytes;
  }

  const metadata = summary(entries.length);
  if (format === "csv") {
    return [
      { type: "text" as const, text: [header, ...entries].join(separator) },
      { type: "text" as const, text: metadata },
    ];
  }
  const text = metadata.slice(0, -1) + jsonDataPrefix + entries.join(separator) + jsonSuffix;
  return [{ type: "text" as const, text }];
}

function csvCell(value: string): string {
  return /[",\r\n]/.test(value) ? '"' + value.replaceAll('"', '""') + '"' : value;
}
