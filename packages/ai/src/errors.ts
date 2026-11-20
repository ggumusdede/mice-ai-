export type AiErrorCode =
  | 'auth' // invalid / missing API key, permission denied
  | 'rate_limit' // 429 after SDK retries
  | 'overloaded' // 529 / 5xx after SDK retries
  | 'network' // connection error / timeout after SDK retries
  | 'bad_request' // 400/404/413/422: our request is wrong (e.g. PDF too large)
  | 'refusal' // model declined (stop_reason "refusal")
  | 'truncated' // stop_reason "max_tokens": output incomplete
  | 'invalid_output' // response did not parse as the expected JSON
  | 'unsupported_input' // e.g. a binary .xlsx was passed instead of CSV text
  | 'pii_unmaskable' // binary document while binary documents are disabled (KVKK setting)
  | 'unknown';

/** Typed error thrown by every AiService implementation. `retryable` tells the caller whether a later retry may succeed. */
export class AiError extends Error {
  readonly retryable: boolean;
  constructor(
    readonly code: AiErrorCode,
    message: string,
    opts: { retryable?: boolean; status?: number; cause?: unknown; operation?: string } = {},
  ) {
    super(message, { cause: opts.cause });
    this.name = 'AiError';
    this.retryable = opts.retryable ?? ['rate_limit', 'overloaded', 'network'].includes(code);
    this.status = opts.status;
    this.operation = opts.operation;
  }
  readonly status?: number;
  readonly operation?: string;
}
