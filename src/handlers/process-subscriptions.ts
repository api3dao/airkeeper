import * as path from 'path';
import * as utils from '@api3/airnode-utilities';
import { goSync } from '@api3/promise-utils';
import isNil from 'lodash/isNil';
import { loadConfig } from '../config';
import { getSponsorWalletAndTransactionCount, initializeProvider, processSponsorWallet } from '../evm';
import { ProviderSponsorProcessSubscriptionsState, ProviderSponsorSubscriptionsState } from '../types';
import { shortenAddress } from '../wallet';

export const processSubscriptions = async (providerSponsorSubscriptions: ProviderSponsorProcessSubscriptionsState) => {
  const { sponsorAddress, providerState, subscriptions } = providerSponsorSubscriptions;
  const { airnodeWallet, providerName, chainId, provider, contracts, voidSigner, currentBlock, gasTarget } =
    providerState;

  utils.addMetadata({ 'Chain-ID': chainId, Provider: providerName, Sponsor: shortenAddress(sponsorAddress) });

  // Fetch sponsor wallet transaction counts to be able to assign nonces to subscriptions
  const [transactionCountLogs, walletData] = await getSponsorWalletAndTransactionCount(
    airnodeWallet,
    provider,
    currentBlock.number,
    sponsorAddress
  );

  // Skip processing for the current sponsorAddress if the wallet functions fail
  if (isNil(walletData)) {
    utils.logger.warn('Failed to fetch sponsor wallet or transaction count');
    utils.removeMetadata(['Chain-ID', 'Provider', 'Sponsor']);
    return;
  }

  const { sponsorWallet, transactionCount } = walletData;

  utils.addMetadata({ 'Sponsor-Wallet': shortenAddress(sponsorWallet.address) });
  utils.logger.logPending(transactionCountLogs);

  utils.logger.info(`Processing ${subscriptions.length} subscription(s)`);

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
    utils.addMetadata({ 'Subscription-ID': data.id });
    utils.logger.logPending(logs);
    utils.removeMetadata(['Subscription-ID']);
  });

  utils.removeMetadata(['Chain-ID', 'Provider', 'Sponsor', 'Sponsor-Wallet']);
};

export const handler = async (payload: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  logOptions: utils.LogOptions;
}) => {
  utils.logger.debug(`Payload: ${JSON.stringify(payload, null, 2)}`);

  const { providerSponsorSubscriptions } = payload;

  const config = goSync(() => loadConfig(path.join(__dirname, '..', '..', 'config', 'airkeeper.json'), process.env));
  if (!config.success) {
    utils.logger.error(config.error.message);
    throw config.error;
  }

  const providerState = await initializeProvider(
    config.data.nodeSettings.airnodeWalletMnemonic,
    providerSponsorSubscriptions.providerState
  );

  await processSubscriptions({
    ...providerSponsorSubscriptions,
    providerState: { ...providerSponsorSubscriptions.providerState, ...providerState },
  });

  utils.logger.info(
    `Processing subscriptions for sponsorAddress: ${providerSponsorSubscriptions.sponsorAddress} has finished`
  );
};
