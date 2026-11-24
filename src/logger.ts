import {
  SeverityNumber,
  context,
  logs,
  trace,
  type AnyValue,
  type Attributes,
} from "@opentelemetry/api";

import { isSensitiveField, secretRedactor } from "./toolOutput.js";

const otelLogger = logs.getLogger("@jahales/redash-mcp");

/** Log levels understood by MCP clients and mapped to OTel severities. */
export enum LogLevel {
  DEBUG = "debug",
  INFO = "info",
  NOTICE = "notice",
  WARNING = "warning",
  ERROR = "error",
  CRITICAL = "critical",
  ALERT = "alert",
  EMERGENCY = "emergency",
}

export type LogFields = Record<string, unknown>;

interface LoggingServer {
  sendLoggingMessage(params: { level: LogLevel; data: string }): Promise<void>;
}

/**
 * Emits each application log to stderr, to the active OpenTelemetry Logs
 * provider, and optionally to the attached stdio MCP client. stderr is
 * intentional: stdout remains exclusively available for MCP messages.
 */
export class Logger {
  private server: LoggingServer | null = null;

  /** Attach the single stdio MCP connection that should receive log notifications. */
  setServer(server: LoggingServer | null): void {
    this.server = server;
  }

  debug(message: string, fields?: LogFields, error?: unknown): void {
    this.log(LogLevel.DEBUG, message, fields, error);
  }

  info(message: string, fields?: LogFields, error?: unknown): void {
    this.log(LogLevel.INFO, message, fields, error);
  }

  warning(message: string, fields?: LogFields, error?: unknown): void {
    this.log(LogLevel.WARNING, message, fields, error);
  }

  error(message: string, fields?: LogFields, error?: unknown): void {
    this.log(LogLevel.ERROR, message, fields, error);
  }

  log(level: LogLevel, message: string, fields?: LogFields, error?: unknown): void {
    const activeContext = context.active();
    const spanContext = trace.getSpanContext(activeContext);
    const redact = secretRedactor();
    const attributes = normalizeAttributes(fields, redact);
    const safeMessage = redact(message);
    const exception = error instanceof Error ? new Error(redact(error.message)) : undefined;
    if (exception && error instanceof Error) exception.name = redact(error.name);

    otelLogger.emit({
      severityNumber: severityNumber(level),
      severityText: level.toUpperCase(),
      body: safeMessage,
      attributes,
      context: activeContext,
      ...(exception ? { exception } : {}),
    });

    const correlation = spanContext?.traceId && spanContext.spanId
      ? ` trace_id=${spanContext.traceId} span_id=${spanContext.spanId}`
      : "";
    console.error(`[${level.toUpperCase()}] ${safeMessage}${correlation}`);

    if (this.server) {
      const reportSendFailure = (sendError: unknown) => {
        console.error(`Failed to send log notification: ${redact(formatUnknown(sendError))}`);
      };
      try {
        void this.server.sendLoggingMessage({ level, data: safeMessage }).catch(reportSendFailure);
      } catch (sendError) {
        reportSendFailure(sendError);
      }
    }
  }
}

function formatUnknown(value: unknown): string {
  if (value instanceof Error) {
    return value.message;
  }
  return String(value);
}

function severityNumber(level: LogLevel): SeverityNumber {
  switch (level) {
    case LogLevel.DEBUG:
      return SeverityNumber.DEBUG;
    case LogLevel.INFO:
      return SeverityNumber.INFO;
    case LogLevel.NOTICE:
      return SeverityNumber.INFO2;
    case LogLevel.WARNING:
      return SeverityNumber.WARN;
    case LogLevel.ERROR:
      return SeverityNumber.ERROR;
    case LogLevel.CRITICAL:
      return SeverityNumber.FATAL;
    case LogLevel.ALERT:
      return SeverityNumber.FATAL2;
    case LogLevel.EMERGENCY:
      return SeverityNumber.FATAL4;
  }
}

const MAX_ATTRIBUTE_DEPTH = 5;
const CIRCULAR_ATTRIBUTE_VALUE = "[Circular]";
const MAX_DEPTH_ATTRIBUTE_VALUE = "[MaxDepth]";
const UNSERIALIZABLE_ATTRIBUTE_VALUE = "[Unserializable]";

function normalizeAttributes(
  fields: LogFields | undefined,
  redact: (text: string) => string,
  seen: WeakSet<object> = new WeakSet(),
  depth = 0,
): Attributes | undefined {
  if (!fields) {
    return undefined;
  }

  seen.add(fields);
  const attributes: Attributes = {};
  try {
    for (const [key, value] of Object.entries(fields)) {
      if (isSensitiveField(key)) continue;
      const normalized = normalizeAttributeValue(value, redact, seen, depth);
      if (normalized !== undefined) {
        attributes[redact(key)] = normalized;
      }
    }
  } catch {
    return { normalization_error: UNSERIALIZABLE_ATTRIBUTE_VALUE };
  }
  return attributes;
}

function normalizeAttributeValue(
  value: unknown,
  redact: (text: string) => string,
  seen: WeakSet<object>,
  depth: number,
): AnyValue {
  if (typeof value === "string") return redact(value);
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (value instanceof Error) {
    return { name: redact(value.name), message: redact(value.message) };
  }
  if (typeof value === "object") {
    if (seen.has(value)) {
      return CIRCULAR_ATTRIBUTE_VALUE;
    }
    if (depth >= MAX_ATTRIBUTE_DEPTH) {
      return MAX_DEPTH_ATTRIBUTE_VALUE;
    }

    seen.add(value);
    try {
      if (Array.isArray(value)) {
        return value
          .map((entry) => normalizeAttributeValue(entry, redact, seen, depth + 1))
          .filter((entry) => entry !== undefined);
      }
      return normalizeAttributes(value as LogFields, redact, seen, depth + 1) ?? {};
    } catch {
      return UNSERIALIZABLE_ATTRIBUTE_VALUE;
    } finally {
      seen.delete(value);
    }
  }
  return value === undefined ? undefined : redact(String(value));
}

export const logger = new Logger();
