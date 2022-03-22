import * as node from '@api3/airnode-node';
import * as protocol from '@api3/airnode-protocol';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { ChainConfig, EVMProviderState } from '../types';
import { DEFAULT_RETRY_TIMEOUT_MS } from '../constants';

const rrpBeaconServerAbi = new ethers.utils.Interface(protocol.RrpBeaconServerFactory.abi).format(
  ethers.utils.FormatTypes.minimal
);

export const dapiServerAbi = [
  'function conditionPspBeaconUpdate(bytes32,bytes,bytes) view returns (bool)',
  'function fulfillPspBeaconUpdate(bytes32,address,address,address,uint256,bytes,bytes)',
];

const abis: { [contractName: string]: string | string[] } = {
  RrpBeaconServer: rrpBeaconServerAbi,
  DapiServer: dapiServerAbi,
};

export const initializeProvider = async (
  chain: ChainConfig,
  providerUrl: string
): Promise<node.LogsData<EVMProviderState | null>> => {
  const provider = node.evm.buildEVMProvider(providerUrl, chain.id);

  const contracts = Object.entries(chain.contracts).reduce((acc, [contractName, contractAddress]) => {
    if (isNil(abis[contractName])) {
      return acc;
    }
    return { ...acc, [contractName]: new ethers.Contract(contractAddress, abis[contractName], provider) };
  }, {});
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  // Fetch current block number
  const currentBlock = await go(() => provider.getBlockNumber(), { timeoutMs: DEFAULT_RETRY_TIMEOUT_MS });
  if (!currentBlock.success) {
    const message = 'Failed to fetch the blockNumber';
    const log = node.logger.pend('ERROR', message, currentBlock.error);
    return [[log], null];
  }
  const currentBlockMessage = `Current block number for chainId ${chain.id}: ${currentBlock.data}`;
  const currentBlockLog = node.logger.pend('INFO', currentBlockMessage);

  // Fetch current gas fee data
  const [gasPriceLogs, gasTarget] = await node.evm.getGasPrice({
    provider,
    chainOptions: chain.options,
  });
  if (!gasTarget) {
    const message = 'Failed to fetch gas price';
    const log = node.logger.pend('ERROR', message);
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
  const gasTargetLog = node.logger.pend('INFO', gasTargetMessage);

  return [
    [currentBlockLog, ...gasPriceLogs, gasTargetLog],
    {
      provider,
      contracts,
      voidSigner,
      currentBlock: currentBlock.data,
      gasTarget,
    },
  ];
};
