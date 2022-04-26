import * as path from 'path';
import * as utils from '@api3/airnode-utilities';
import { goSync } from '@api3/promise-utils';
import isNil from 'lodash/isNil';
import { loadConfig } from '../config';
import { getSponsorWalletAndTransactionCount, initializeProvider, processSponsorWallet } from '../evm';
import { buildLogOptions } from '../logger';
import { ProviderSponsorProcessSubscriptionsState, ProviderSponsorSubscriptionsState } from '../types';
import { shortenAddress } from '../wallet';

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
    currentBlock.number,
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
    transactionCount,
    currentBlock.timestamp
  );

  processSponsorWalletResult.forEach(([logs, data]) => {
    const subscriptionLogOptions = buildLogOptions('additional', { subscriptionId: data.id }, sponsorWalletLogOptions);
    utils.logger.logPending(logs, subscriptionLogOptions);
  });
};

export const handler = async (payload: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  baseLogOptions: utils.LogOptions;
}) => {
  utils.logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

  const { providerSponsorSubscriptions, baseLogOptions } = payload;

  const config = goSync(() => loadConfig(path.join(__dirname, '..', '..', 'config', 'airkeeper.json'), process.env));
  if (!config.success) {
    utils.logger.error(config.error.message);
    throw config.error;
  }

  const providerState = await initializeProvider(
    config.data.nodeSettings.airnodeWalletMnemonic,
    providerSponsorSubscriptions.providerState
  );

  await processSubscriptions(
    {
      ...providerSponsorSubscriptions,
      providerState: { ...providerSponsorSubscriptions.providerState, ...providerState },
    },
    baseLogOptions
  );

  utils.logger.info(
    `Processing subscriptions for sponsorAddress: ${providerSponsorSubscriptions.sponsorAddress} has finished`,
    baseLogOptions
  );
};
