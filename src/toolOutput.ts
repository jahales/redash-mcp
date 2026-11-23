import { getRequestRedashApiKey } from "./requestAuth.js";

const DEFAULT_MAX_ROWS = 200;
export const MAX_RESPONSE_BYTES = 64 * 1024;
const sensitiveFields = /^(?:api[_-]?key|authorization|proxy[_-]?authorization|cookie|set[_-]?cookie|password|(?:client[_-]?|webhook[_-]?)?secret|(?:private|signing)[_-]?key|access[_-]?token|refresh[_-]?token|token|public[_-]?url)$/i;

export function parseExtraHeaders(raw = process.env.REDASH_EXTRA_HEADERS): Record<string, string> {
  if (!raw) return {};

  try {
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return Object.fromEntries(
        Object.entries(parsed)
          .filter(([, value]) => value !== undefined && value !== null)
          .map(([key, value]) => [key, String(value)]),
      );
    }
  } catch { /* Fall through to the key=value syntax. */ }

  return Object.fromEntries(raw.split(/[;,]/).flatMap(part => {
    const delimiter = part.indexOf("=");
    if (delimiter < 0) return [];
    const key = part.slice(0, delimiter).trim();
    return key ? [[key, part.slice(delimiter + 1).trim()]] : [];
  }));
}

export function secretRedactor(): (text: string) => string {
  const secrets = [
    process.env.REDASH_API_KEY,
    getRequestRedashApiKey(),
    ...Object.values(parseExtraHeaders()),
  ].filter((value): value is string => Boolean(value));
  // Match against the original text so redaction markers are never themselves redacted.
  if (secrets.length === 0) return text => text;
  const variants = new Set(secrets);
  for (const secret of secrets) {
    const encoded = new URLSearchParams([["", secret]]).toString().slice(1);
    variants.add(encoded);
    variants.add(encoded.replaceAll("+", "%20"));
  }
  const pattern = new RegExp(
    [...variants].sort((a, b) => b.length - a.length).map(value => value.replace(/[|\\{}()[\]^$+*?.]/g, "\\$&")).join("|"),
    "g",
  );
  return text => text.replace(pattern, "[redacted]");
}

export function isSensitiveField(key: string): boolean {
  return sensitiveFields.test(key);
}

export function safeJson(value: unknown, parseJsonText = false): string {
  const redact = secretRedactor();
  return JSON.stringify(value, (key, data: unknown) => {
    if (isSensitiveField(key)) return undefined;
    if (typeof data === "string") {
      if (parseJsonText && key === "text" && /^[{\[]/.test(data.trimStart())) {
        try {
          return safeJson(JSON.parse(data));
        } catch { /* Preserve plain text that only looks like JSON. */ }
      }
      return redact(data);
    }
    if (data && typeof data === "object" && !Array.isArray(data)) {
      return Object.fromEntries(
        Object.entries(data).filter(([childKey]) => !isSensitiveField(childKey))
          .map(([childKey, child]) => [redact(childKey), child]),
      );
    }
    return data;
  });
}

export function configuredMaxRows(): number {
  const value = process.env.REDASH_MAX_RESULTS ?? String(DEFAULT_MAX_ROWS);
  const maximum = Number(value);
  if (!/^\d+$/.test(value) || !Number.isSafeInteger(maximum) || maximum < 1) {
    throw new Error("REDASH_MAX_RESULTS must be a positive integer.");
  }
  return maximum;
}

export function maxRows(requested?: number): number {
  const maximum = configuredMaxRows();
  return Math.min(requested ?? maximum, maximum);
}

export function fitsResponse(text: string): boolean {
  return Buffer.byteLength(text, "utf8") <= MAX_RESPONSE_BYTES;
}
