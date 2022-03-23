// The number of past blocks to lookup when fetching events.
export const BLOCK_COUNT_HISTORY_LIMIT = 300;

// The default amount of time before a "retryable" promise is timed out and retried
export const TIMEOUT_MS = 5_000;

// The default amount of retries
export const RETRIES = 1;

// The Priority Fee in Wei
export const PRIORITY_FEE_IN_WEI = 3_120_000_000;

// The Base Fee to Max Fee multiplier
export const BASE_FEE_MULTIPLIER = 2;

// The default gas limit for transactions
export const GAS_LIMIT = 500_000;

// The protocol id for PSP used when deriving sponsor wallet addresses
export const PROTOCOL_ID_PSP = '2';
