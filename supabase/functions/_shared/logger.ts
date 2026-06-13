// Shared logging utility for Supabase Edge Functions
// Provides structured JSON logging with request IDs, timestamps, and levels

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  requestId?: string;
  userId?: string;
  functionName?: string;
  metadata?: Record<string, unknown>;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let minLevel: LogLevel = 'info';

export function setLogLevel(level: LogLevel) {
  minLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LEVEL_PRIORITY[level] >= LEVEL_PRIORITY[minLevel];
}

function formatEntry(entry: LogEntry): string {
  return JSON.stringify(entry);
}

function createEntry(
  level: LogLevel,
  message: string,
  options: {
    requestId?: string;
    userId?: string;
    functionName?: string;
    metadata?: Record<string, unknown>;
    error?: Error | unknown;
  } = {}
): LogEntry {
  const { requestId, userId, functionName, metadata, error } = options;
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    requestId,
    userId,
    functionName,
    metadata,
  };
  if (error) {
    entry.error = {
      name: error instanceof Error ? error.name : 'Error',
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    };
  }
  return entry;
}

export const logger = {
  debug(message: string, options?: Parameters<typeof createEntry>[1]) {
    if (shouldLog('debug')) console.debug(formatEntry(createEntry('debug', message, options)));
  },
  info(message: string, options?: Parameters<typeof createEntry>[1]) {
    if (shouldLog('info')) console.info(formatEntry(createEntry('info', message, options)));
  },
  warn(message: string, options?: Parameters<typeof createEntry>[1]) {
    if (shouldLog('warn')) console.warn(formatEntry(createEntry('warn', message, options)));
  },
  error(message: string, options?: Parameters<typeof createEntry>[1]) {
    if (shouldLog('error')) console.error(formatEntry(createEntry('error', message, options)));
  },

  // Convenience methods for common observability patterns
  requestStart(requestId: string, functionName: string, metadata?: Record<string, unknown>) {
    this.info('Request started', { requestId, functionName, metadata });
  },
  requestEnd(requestId: string, functionName: string, latencyMs: number, metadata?: Record<string, unknown>) {
    this.info('Request completed', { requestId, functionName, metadata: { ...metadata, latencyMs } });
  },
  requestError(requestId: string, functionName: string, error: Error | unknown, metadata?: Record<string, unknown>) {
    this.error('Request failed', { requestId, functionName, error, metadata });
  },
  authCheck(requestId: string, userId: string | null, success: boolean, metadata?: Record<string, unknown>) {
    this.info('Auth check', { requestId, userId: userId || undefined, metadata: { ...metadata, success } });
  },
  providerCall(requestId: string, model: string, attempt: number, metadata?: Record<string, unknown>) {
    this.debug('Provider call attempt', { requestId, metadata: { ...metadata, model, attempt } });
  },
  providerSuccess(requestId: string, model: string, latencyMs: number, usage?: Record<string, unknown>) {
    this.info('Provider success', { requestId, metadata: { model, latencyMs, usage } });
  },
  providerError(requestId: string, model: string, error: Error | unknown, metadata?: Record<string, unknown>) {
    this.warn('Provider error', { requestId, metadata: { model, ...metadata }, error });
  },
  usageCheck(requestId: string, userId: string, allowed: boolean, count: number, limit: number) {
    this.info('Usage check', { requestId, userId, metadata: { allowed, count, limit } });
  },
  dbQuery(requestId: string, table: string, operation: string, durationMs: number, metadata?: Record<string, unknown>) {
    this.debug('DB query', { requestId, metadata: { ...metadata, table, operation, durationMs } });
  },
};

export function createRequestLogger(requestId: string, functionName: string) {
  return {
    debug: (message: string, metadata?: Record<string, unknown>) => logger.debug(message, { requestId, functionName, metadata }),
    info: (message: string, metadata?: Record<string, unknown>) => logger.info(message, { requestId, functionName, metadata }),
    warn: (message: string, metadata?: Record<string, unknown>) => logger.warn(message, { requestId, functionName, metadata }),
    error: (message: string, metadata?: Record<string, unknown>) => logger.error(message, { requestId, functionName, metadata }),
  };
}

export function generateRequestId(): string {
  return crypto.randomUUID();
}

// Helper to extract request ID from headers or generate new
export function getOrCreateRequestId(req: Request): string {
  return req.headers.get('x-request-id') || generateRequestId();
}