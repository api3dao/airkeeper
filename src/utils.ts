import * as node from '@api3/airnode-node';
import { DEFAULT_RETRY_TIMEOUT_MS } from './constants';

const retryGo = <T>(fn: () => Promise<T>, options?: node.utils.PromiseOptions) =>
  node.utils.go(() => node.utils.retryOnTimeout(DEFAULT_RETRY_TIMEOUT_MS, fn), options);

export { retryGo };
