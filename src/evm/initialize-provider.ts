import * as node from '@api3/airnode-node';
import { LogsData } from '@api3/airnode-node';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { ChainConfig, EVMProviderState } from '../types';
import { retryGo } from '../utils';

//TODO: where to get abi from?
const dapiServerAbi = [
  'function conditionPspBeaconUpdate(bytes32,bytes,bytes) view returns (bool)',
  'function fulfillPspBeaconUpdate(bytes32,address,address,address,uint256,bytes,bytes)',
];

export const initializeProvider = async (
  chain: ChainConfig,
  providerUrl: string
): Promise<LogsData<EVMProviderState | null>> => {
  const provider = node.evm.buildEVMProvider(providerUrl, chain.id);

  const dapiServer = new ethers.Contract(chain.contracts.DapiServer, dapiServerAbi, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  // **************************************************************************
  // Fetch current block number
  // **************************************************************************
  const [errorGetBlockNumber, currentBlock] = await retryGo(() => provider.getBlockNumber());
  if (errorGetBlockNumber || isNil(currentBlock)) {
    const message = 'Failed to fetch the blockNumber';
    const log = node.logger.pend('ERROR', message, errorGetBlockNumber);
    return [[log], null];
  }
  const currentBlockMessage = `Current block number for chainId ${chain.id}: ${currentBlock}`;
  const currentBlockLog = node.logger.pend('DEBUG', currentBlockMessage);

  // **************************************************************************
  // Fetch current gas fee data
  // **************************************************************************
  const [gasPriceLogs, gasTarget] = await node.evm.getGasPrice({
    provider,
    chainOptions: chain.options,
  });
  if (!gasTarget) {
    const message = 'Failed to fetch gas price';
    const log = node.logger.pend('ERROR', message);
    return [[log], null];
  }
  const gasTargetMessage = `Gas target for chainId ${chain.id}: ${JSON.stringify(gasTarget)}`;
  const gasTargetLog = node.logger.pend('DEBUG', gasTargetMessage);

  return [
    [...gasPriceLogs, currentBlockLog, gasTargetLog],
    {
      provider,
      contracts: { ['DapiServer']: dapiServer },
      voidSigner,
      currentBlock,
      gasTarget,
    },
  ];
};
