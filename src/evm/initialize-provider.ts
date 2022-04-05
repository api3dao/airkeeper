import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ChainConfig, EVMBaseState } from '../types';
import { TIMEOUT_MS, RETRIES } from '../constants';

export const initializeProvider = async (
  chain: ChainConfig,
  providerUrl: string
): Promise<node.LogsData<EVMBaseState | null>> => {
  const provider = node.evm.buildEVMProvider(providerUrl, chain.id);

  // Fetch current block number
  const currentBlock = await go(() => provider.getBlockNumber(), { timeoutMs: TIMEOUT_MS, retries: RETRIES });
  if (!currentBlock.success) {
    const message = 'Failed to fetch the blockNumber';
    const log = utils.logger.pend('ERROR', message, currentBlock.error);
    return [[log], null];
  }
  const currentBlockMessage = `Current block number for chainId ${chain.id}: ${currentBlock.data}`;
  const currentBlockLog = utils.logger.pend('INFO', currentBlockMessage);

  // Fetch current gas fee data
  const [gasPriceLogs, gasTarget] = await utils.getGasPrice({
    provider,
    chainOptions: chain.options,
  });
  if (!gasTarget) {
    const message = 'Failed to fetch gas price';
    const log = utils.logger.pend('ERROR', message);
    return [[log], null];
  }
  let gasTargetMessage;
  if (chain.options.txType === 'eip1559') {
    const gweiMaxFee = node.evm.weiToGwei(gasTarget.maxFeePerGas!);
    const gweiPriorityFee = node.evm.weiToGwei(gasTarget.maxPriorityFeePerGas!);
    gasTargetMessage = `Gas price (EIP-1559) set to a Max Fee of ${gweiMaxFee} Gwei and a Priority Fee of ${gweiPriorityFee} Gwei`;
  } else {
    const gweiPrice = node.evm.weiToGwei(gasTarget.gasPrice!);
    gasTargetMessage = `Gas price (legacy) set to ${gweiPrice} Gwei`;
  }
  const gasTargetLog = utils.logger.pend('INFO', gasTargetMessage);

  return [
    [currentBlockLog, ...gasPriceLogs, gasTargetLog],
    {
      currentBlock: currentBlock.data,
      gasTarget,
    },
  ];
};
