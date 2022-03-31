import { ethers } from 'ethers';
import * as utils from '@api3/airnode-utilities';
import { goSync } from '@api3/promise-utils';
import isNil from 'lodash/isNil';
import { loadAirnodeConfig } from '../config';
import { getSponsorWalletAndTransactionCount, processSponsorWallet, initializeProvider } from '../evm';
import { buildLogOptions } from '../logger';
import { shortenAddress } from '../wallet';
import { ProviderSponsorSubscriptions, ProviderSponsorSubscriptionsState, AWSHandlerResponse } from '../types';

export const processSubscriptions = async (
  providerSponsorSubscription: ProviderSponsorSubscriptionsState,
  baseLogOptions: utils.LogOptions
) => {
  const { sponsorAddress, providerState, subscriptions } = providerSponsorSubscription;
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

export const handler = async ({
  providerSponsorSubscription,
  baseLogOptions,
}: {
  providerSponsorSubscription: ProviderSponsorSubscriptions;
  baseLogOptions: utils.LogOptions;
}): Promise<AWSHandlerResponse> => {
  const airnodeConfig = goSync(loadAirnodeConfig);
  if (!airnodeConfig.success) {
    utils.logger.error(airnodeConfig.error.message);
    throw airnodeConfig.error;
  }

  const airnodeWallet = ethers.Wallet.fromMnemonic(airnodeConfig.data.nodeSettings.airnodeWalletMnemonic);

  // Initialize provider specific data
  const [logs, evmProviderState] = await initializeProvider(
    providerSponsorSubscription.providerGroup.chainConfig,
    providerSponsorSubscription.providerGroup.providerUrl || ''
  );
  const providerLogOptions = buildLogOptions(
    'meta',
    {
      chainId: providerSponsorSubscription.providerGroup.chainId,
      providerName: providerSponsorSubscription.providerGroup.providerName,
    },
    baseLogOptions
  );
  utils.logger.logPending(logs, providerLogOptions);
  if (isNil(evmProviderState)) {
    const message = 'Failed to initialize provider';
    utils.logger.warn(message, providerLogOptions);

    return {
      statusCode: 500,
      ok: false,
      message: `Failed to initialize provider: ${providerSponsorSubscription.providerGroup.providerName} for chain: ${providerSponsorSubscription.providerGroup.chainId}`,
    };
  }

  await processSubscriptions(
    {
      ...providerSponsorSubscription,
      providerState: { ...providerSponsorSubscription.providerGroup, airnodeWallet, ...evmProviderState },
    },
    baseLogOptions
  );

  return {
    statusCode: 200,
    ok: true,
    message: `Processing subscriptions for sponsorAddress: ${providerSponsorSubscription.sponsorAddress} has finished`,
  };
};
