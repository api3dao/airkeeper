import { BigNumber, ethers } from "ethers";
import * as node from "@api3/airnode-node";

interface FetchOptions {
  readonly provider: ethers.providers.JsonRpcProvider;
}

export interface GasTarget {
  readonly maxPriorityFeePerGas?: BigNumber;
  readonly maxFeePerGas?: BigNumber;
  readonly gasPrice?: BigNumber;
}

// The Priority Fee in Wei
export const PRIORITY_FEE = "3120000000";

// The Base Fee to Max Fee multiplier
export const BASE_FEE_MULTIPLIER = 2;

// The default amount of time before a "retryable" promise is timed out and retried
export const DEFAULT_RETRY_TIMEOUT_MS = 5_000;

export const getGasPrice = async (
  options: FetchOptions
): Promise<node.LogsData<GasTarget | null>> => {
  const { provider } = options;
  const [logs, blockGas] = await (async (): Promise<
    [node.PendingLog[], GasTarget | null]
  > => {
    const operation = () => provider.getBlock("latest");
    const [err, blockHeader] = await node.utils.go(operation, {
      retries: 1,
      timeoutMs: DEFAULT_RETRY_TIMEOUT_MS,
    });
    if (err || !blockHeader?.baseFeePerGas) {
      const log = node.logger.pend(
        "INFO",
        "Failed to get EIP-1559 gas pricing from provider - trying fallback",
        err
      );

      return [[log], null];
    }

    const maxPriorityFeePerGas = BigNumber.from(PRIORITY_FEE);
    const maxFeePerGas = blockHeader.baseFeePerGas
      .mul(BASE_FEE_MULTIPLIER)
      .add(maxPriorityFeePerGas);

    return [
      [],
      {
        maxPriorityFeePerGas,
        maxFeePerGas,
      } as GasTarget,
    ];
  })();

  if (blockGas) {
    return [logs, blockGas];
  }

  // Fallback to pre-EIP-1559
  const operation = () => provider.getGasPrice();
  const [err, gasPrice] = await node.utils.go(operation, {
    retries: 1,
    timeoutMs: DEFAULT_RETRY_TIMEOUT_MS,
  });
  if (err || !gasPrice) {
    const log = node.logger.pend(
      "ERROR",
      "Failed to get fallback gas price from provider",
      err
    );
    return [[...logs, log], null];
  }

  return [[...logs], { gasPrice }];
};
