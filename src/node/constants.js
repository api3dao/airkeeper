"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.WORKER_CALL_API_TIMEOUT = exports.WORKER_PROVIDER_PROCESS_REQUESTS_TIMEOUT = exports.WORKER_PROVIDER_INITIALIZATION_TIMEOUT = exports.EVM_PROVIDER_TIMEOUT = exports.DEFAULT_RETRY_DELAY_MS = exports.DEFAULT_RETRY_TIMEOUT_MS = exports.CONVENIENCE_BATCH_SIZE = exports.BLOCK_MIN_CONFIRMATIONS = exports.BLOCK_COUNT_IGNORE_LIMIT = exports.BLOCK_COUNT_HISTORY_LIMIT = exports.API_CALL_TIMEOUT = exports.API_CALL_TOTAL_TIMEOUT = void 0;
// The maximum TOTAL time an API call has before it is timed out (including retries).
exports.API_CALL_TOTAL_TIMEOUT = 29000;
// The maximum time an API call has before it is timed out (and retried).
exports.API_CALL_TIMEOUT = 20000;
// The number of past blocks to lookup when fetching Airnode RRP events.
exports.BLOCK_COUNT_HISTORY_LIMIT = 300;
// Certain events cause requests to be "blocked" (e.g. the template cannot be fetched)
// In order to preserve nonce ordering, these blocked requests also cause later requests
// to become blocked. Once this number of blocks has passed, these blocked requests will become
// "ignored" and no longer block later requests.
exports.BLOCK_COUNT_IGNORE_LIMIT = 20;
// The minimum number of block confirmations required.
exports.BLOCK_MIN_CONFIRMATIONS = 0;
// The Convenience contract allows for returning multiple items in order to reduce calls
// to the blockchain provider. This number is the maximum number of items that can get returned
// in a single call.
exports.CONVENIENCE_BATCH_SIZE = 10;
// The default amount of time before a "retryable" promise is timed out and retried
exports.DEFAULT_RETRY_TIMEOUT_MS = 5000;
// The default amount of time to wait before retrying a given promise
exports.DEFAULT_RETRY_DELAY_MS = 50;
// The amount of time EVM provider calls are allowed
exports.EVM_PROVIDER_TIMEOUT = 10000;
// The maximum amount of time the "initialize provider" worker is allowed before being timed out
exports.WORKER_PROVIDER_INITIALIZATION_TIMEOUT = 19500;
// The maximum amount of time the "process requests" worker is allowed before being timed out
exports.WORKER_PROVIDER_PROCESS_REQUESTS_TIMEOUT = 9500;
// The maximum amount of time the "call API" worker is allowed before being timed out
exports.WORKER_CALL_API_TIMEOUT = 29500;
