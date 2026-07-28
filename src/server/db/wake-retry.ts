const TRANSIENT_CONNECTION_CODES = new Set([
  "08000",
  "08001",
  "08003",
  "08004",
  "08006",
  "08007",
  "08P01",
  "57P01",
  "57P02",
  "57P03",
  "CONNECT_TIMEOUT",
  "CONNECTION_CLOSED",
  "EAI_AGAIN",
  "ECONNREFUSED",
  "ECONNRESET",
  "EHOSTUNREACH",
  "ENETDOWN",
  "ENETUNREACH",
  "ENOTFOUND",
  "ETIMEDOUT",
]);

const TRANSIENT_CONNECTION_MESSAGES = [
  "connection closed",
  "connection refused",
  "connection terminated unexpectedly",
  "connection timeout",
  "database system is starting up",
  "getaddrinfo eai_again",
  "server closed the connection unexpectedly",
];

type ErrorLike = {
  cause?: unknown;
  code?: unknown;
  errors?: unknown;
  message?: unknown;
};

function errorParts(error: unknown, seen = new Set<unknown>()): ErrorLike[] {
  if (!error || typeof error !== "object" || seen.has(error)) return [];
  seen.add(error);

  const item = error as ErrorLike;
  const nested = Array.isArray(item.errors) ? item.errors : [];
  return [
    item,
    ...errorParts(item.cause, seen),
    ...nested.flatMap((entry) => errorParts(entry, seen)),
  ];
}

/**
 * Restrict retries to failures that happen while establishing or restoring a
 * connection. SQL, authentication, validation, and constraint errors must fail
 * immediately and must never cause a mutation to be replayed.
 */
export function isTransientDatabaseWakeError(error: unknown): boolean {
  return errorParts(error).some((part) => {
    if (typeof part.code === "string" && TRANSIENT_CONNECTION_CODES.has(part.code)) return true;
    if (typeof part.message !== "string") return false;
    const message = part.message.toLowerCase();
    return TRANSIENT_CONNECTION_MESSAGES.some((fragment) => message.includes(fragment));
  });
}

type RetryOptions = {
  timeoutMs?: number;
  maxAttempts?: number;
  initialDelayMs?: number;
  maxDelayMs?: number;
  onRetry?: (attempt: number, error: unknown) => void;
};

/** Retry a connection-only operation while a serverless database wakes. */
export async function retryDatabaseWake<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const timeoutMs = options.timeoutMs ?? 90_000;
  const maxAttempts = options.maxAttempts ?? Number.POSITIVE_INFINITY;
  const initialDelayMs = options.initialDelayMs ?? 250;
  const maxDelayMs = options.maxDelayMs ?? 5_000;
  const deadline = Date.now() + timeoutMs;
  let attempt = 0;

  while (true) {
    attempt += 1;
    try {
      return await operation();
    } catch (error) {
      if (
        !isTransientDatabaseWakeError(error) ||
        attempt >= maxAttempts ||
        Date.now() >= deadline
      ) {
        throw error;
      }

      options.onRetry?.(attempt, error);
      const delayMs = Math.min(initialDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const remainingMs = deadline - Date.now();
      await new Promise((resolve) => setTimeout(resolve, Math.min(delayMs, remainingMs)));
    }
  }
}
