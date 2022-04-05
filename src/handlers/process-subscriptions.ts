import { ethers } from 'ethers';
import * as utils from '@api3/airnode-utilities';
import * as protocol from '@api3/airnode-protocol';
import * as node from '@api3/airnode-node';
import { goSync } from '@api3/promise-utils';
import isNil from 'lodash/isNil';
import { loadAirnodeConfig } from '../config';
import { getSponsorWalletAndTransactionCount, processSponsorWallet } from '../evm';
import { buildLogOptions } from '../logger';
import { shortenAddress } from '../wallet';
import {
  ProviderSponsorProcessSubscriptionsState,
  ProviderSponsorSubscriptionsState,
  ProviderState,
  EVMBaseState,
} from '../types';

export const processSubscriptions = async (
  providerSponsorSubscriptions: ProviderSponsorProcessSubscriptionsState,
  baseLogOptions: utils.LogOptions
) => {
  const { sponsorAddress, providerState, subscriptions } = providerSponsorSubscriptions;
  const { airnodeWallet, providerName, chainId, provider, contracts, voidSigner, currentBlock, gasTarget } =
    providerState;

  const providerLogOptions = buildLogOptions('meta', { chainId, providerName }, baseLogOptions);

  // Fetch sponsor wallet transaction counts to be able to assign nonces to subscriptions
  const [transactionCountLogs, walletData] = await getSponsorWalletAndTransactionCount(
    airnodeWallet,
    provider,
    currentBlock,
    sponsorAddress
  );

  // Skip processing for the current sponsorAddress if the wallet functions fail
  if (isNil(walletData)) {
    const sponsorLogOptions = buildLogOptions('additional', { sponsor: sponsorAddress }, providerLogOptions);
    utils.logger.warn('Failed to fetch sponsor wallet or transaction count', sponsorLogOptions);
    return;
  }

  const { sponsorWallet, transactionCount } = walletData;

  const sponsorWalletLogOptions = buildLogOptions(
    'additional',
    { sponsorWallet: shortenAddress(sponsorWallet.address) },
    providerLogOptions
  );
  utils.logger.logPending(transactionCountLogs, sponsorWalletLogOptions);
  utils.logger.info(`Processing ${subscriptions.length} subscription(s)`, sponsorWalletLogOptions);

  const processSponsorWalletResult = await processSponsorWallet(
    airnodeWallet,
    contracts['DapiServer'],
    gasTarget,
    subscriptions,
    sponsorWallet,
    voidSigner,
    transactionCount
  );

  processSponsorWalletResult.forEach(([logs, data]) => {
    const subscriptionLogOptions = buildLogOptions('additional', { subscriptionId: data.id }, sponsorWalletLogOptions);
    utils.logger.logPending(logs, subscriptionLogOptions);
  });
};

const reinitializeProvider = async (airnodeWalletMnemonic: string, providerState: ProviderState<EVMBaseState>) => {
  const airnodeWallet = ethers.Wallet.fromMnemonic(airnodeWalletMnemonic);
  const provider = node.evm.buildEVMProvider(providerState.providerUrl, providerState.chainId);
  const rrpBeaconServerAbi = new ethers.utils.Interface(protocol.RrpBeaconServerFactory.abi).format(
    ethers.utils.FormatTypes.minimal
  );

  const dapiServerAbi = [
    'function conditionPspBeaconUpdate(bytes32,bytes,bytes) view returns (bool)',
    'function fulfillPspBeaconUpdate(bytes32,address,address,address,uint256,bytes,bytes)',
  ];

  const abis: { [contractName: string]: string | string[] } = {
    RrpBeaconServer: rrpBeaconServerAbi,
    DapiServer: dapiServerAbi,
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

export const handler = async ({
  providerSponsorSubscriptions,
  baseLogOptions,
}: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  baseLogOptions: utils.LogOptions;
}) => {
  const airnodeConfig = goSync(loadAirnodeConfig);
  if (!airnodeConfig.success) {
    utils.logger.error(airnodeConfig.error.message);
    throw airnodeConfig.error;
  }

  const reinitializedProviderState = await reinitializeProvider(
    airnodeConfig.data.nodeSettings.airnodeWalletMnemonic,
    providerSponsorSubscriptions.providerState
  );

  await processSubscriptions(
    {
      ...providerSponsorSubscriptions,
      providerState: { ...providerSponsorSubscriptions.providerState, ...reinitializedProviderState },
    },
    baseLogOptions
  );

  utils.logger.info(
    `Processing subscriptions for sponsorAddress: ${providerSponsorSubscriptions.sponsorAddress} has finished`,
    baseLogOptions
  );
};
