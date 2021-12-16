import * as ethers from "ethers";
import * as node from "@api3/airnode-node";
import { FetchOptions, GasTarget, PriorityFee } from "./types";

// The Priority Fee in Wei
export const PRIORITY_FEE = "3120000000";

// The Base Fee to Max Fee multiplier
export const BASE_FEE_MULTIPLIER = 2;

// The default amount of time before a "retryable" promise is timed out and retried
export const DEFAULT_RETRY_TIMEOUT_MS = 5_000;

export const parsePriorityFee = ({ value, unit }: PriorityFee) =>
  ethers.utils.parseUnits(value, unit ?? "wei");

const getLegacyGasPrice = async (
  options: FetchOptions
): Promise<node.LogsData<GasTarget | null>> => {
  const { provider } = options;

  const [err, gasPrice] = await node.utils.go(provider.getGasPrice, {
    retries: 1,
    timeoutMs: DEFAULT_RETRY_TIMEOUT_MS,
  });
  if (err || !gasPrice) {
    const log = node.logger.pend(
      "ERROR",
      "All attempts to get legacy gasPrice from provider failed"
    );
    return [[log], null];
  }

  return [[], { gasPrice }];
};

const getEip1559GasPricing = async (
  options: FetchOptions
): Promise<node.LogsData<GasTarget | null>> => {
  const { provider, chainOptions } = options;
  const logs = Array<node.PendingLog>();

  const [err, blockHeader] = await node.utils.go(
    () => provider.getBlock("latest"),
    {
      retries: 1,
      timeoutMs: DEFAULT_RETRY_TIMEOUT_MS,
    }
  );
  if (err || !blockHeader?.baseFeePerGas) {
    logs.push(
      node.logger.pend(
        "ERROR",
        "All attempts to get EIP-1559 gas pricing from provider failed"
      )
    );

    return [logs, null];
  }

  const maxPriorityFeePerGas = chainOptions.priorityFee
    ? parsePriorityFee(chainOptions.priorityFee)
    : ethers.BigNumber.from(PRIORITY_FEE);
  const baseFeeMultiplier = chainOptions.baseFeeMultiplier
    ? chainOptions.baseFeeMultiplier
    : BASE_FEE_MULTIPLIER;
  const maxFeePerGas = blockHeader.baseFeePerGas
    .mul(ethers.BigNumber.from(baseFeeMultiplier))
    .add(maxPriorityFeePerGas!);

  return [
    logs,
    {
      maxPriorityFeePerGas,
      maxFeePerGas,
    },
  ];
};

export const getGasPrice = async (
  options: FetchOptions
): Promise<node.LogsData<GasTarget | null>> => {
  const { chainOptions } = options;

  switch (chainOptions.txType) {
    case "legacy":
      return getLegacyGasPrice(options);
    case "eip1559":
      return getEip1559GasPricing(options);
  }
};
