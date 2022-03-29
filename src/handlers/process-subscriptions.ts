import { APIGatewayEvent } from 'aws-lambda';
import * as utils from '@api3/airnode-utilities';
import isNil from 'lodash/isNil';
import { getSponsorWalletAndTransactionCount, processSponsorWallet } from '../evm';
import { buildLogOptions } from '../logger';
import { shortenAddress } from '../wallet';
import { ProviderSponsorSubscriptions } from '../types';

export const processSubscriptions = async (
  providerSponsorSubscription: ProviderSponsorSubscriptions,
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

  const logs = await processSponsorWallet(
    airnodeWallet,
    contracts['DapiServer'],
    gasTarget,
    subscriptions,
    sponsorWallet,
    voidSigner,
    transactionCount
  );

  logs.forEach(([logs, data]) => {
    const subscriptionLogOptions = buildLogOptions('additional', { subscriptionId: data.id }, sponsorWalletLogOptions);
    utils.logger.logPending(logs, subscriptionLogOptions);
  });
};

export const handler = async (event: APIGatewayEvent | { body: string }) => {
  const payload: {
    providerSponsorSubscription: ProviderSponsorSubscriptions;
    baseLogOptions: utils.LogOptions;
  } = JSON.parse(event.body!);

  await processSubscriptions(payload.providerSponsorSubscription, payload.baseLogOptions);

  //TODO fix return or remove if InvocationType: 'Event' is used
  return payload;
};
