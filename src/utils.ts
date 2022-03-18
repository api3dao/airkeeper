import { go, retryOnTimeout, PromiseOptions } from '@api3/airnode-utilities';
import { DEFAULT_RETRY_TIMEOUT_MS } from './constants';

// NOTE: There is another PR which will remove this and replace retries with promise-utils package
export const retryGo = <T>(fn: () => Promise<T>, options?: PromiseOptions) =>
  go(() => retryOnTimeout(DEFAULT_RETRY_TIMEOUT_MS, fn), options);
