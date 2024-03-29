import * as node from '@api3/airnode-node';
import * as protocol from '@api3/airnode-protocol';
import { DapiServer__factory as DapiServerFactory } from '@api3/airnode-protocol-v1';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { RETRIES, TIMEOUT_MS } from '../constants';
import { EVMBaseState, ProviderState } from '../types';
import { ChainConfig } from '../validator';

export const initializeProvider = async (airnodeWalletMnemonic: string, providerState: ProviderState<EVMBaseState>) => {
  const airnodeWallet = ethers.Wallet.fromMnemonic(airnodeWalletMnemonic);
  const provider = node.evm.buildEVMProvider(providerState.providerUrl, providerState.chainId);

  const abis: { [contractName: string]: ethers.ContractInterface } = {
    RrpBeaconServer: protocol.RrpBeaconServerV0Factory.abi,
    DapiServer: DapiServerFactory.abi,
  };
  const contracts = Object.entries(providerState.chainConfig.contracts).reduce(
    (acc, [contractName, contractAddress]) => {
      if (isNil(abis[contractName])) {
        return acc;
      }
      return { ...acc, [contractName]: new ethers.Contract(contractAddress, abis[contractName], provider) };
    },
    {}
  );
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  return { airnodeWallet, contracts, voidSigner, provider };
};

export const initializeEvmState = async (
  chain: ChainConfig,
  providerUrl: string
): Promise<node.LogsData<EVMBaseState | null>> => {
  const provider = node.evm.buildEVMProvider(providerUrl, chain.id);

  // Fetch current block number
  const currentBlock = await go(() => provider.getBlock('latest'), { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES });
  if (!currentBlock.success) {
    const message = 'Failed to fetch the block';
    const log = utils.logger.pend('ERROR', message, currentBlock.error);
    return [[log], null];
  }
  const currentBlockMessage = `Current block number for chainId ${chain.id}: ${currentBlock.data.number}`;
  const currentBlockLog = utils.logger.pend('INFO', currentBlockMessage);

  // Fetch current gas fee data
  const [gasPriceLogs, gasTarget] = await utils.getGasPrice(provider, chain.options);

  return [
    [currentBlockLog, ...gasPriceLogs],
    {
      currentBlock: currentBlock.data,
      gasTarget,
    },
  ];
};
