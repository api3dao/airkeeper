import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { Config, SponsorWalletTransactionCount } from '../types';
import { retryGo } from '../utils';
import { deriveSponsorWallet } from '../wallet';

export const getSponsorWalletAndTransactionCount = async (
  config: Config,
  provider: ethers.providers.Provider,
  currentBlock: number,
  sponsor: string
): Promise<node.LogsData<SponsorWalletTransactionCount | null>> => {
  // Derive sponsorWallet address
  // TODO: switch to node.evm.deriveSponsorWallet when @api3/airnode-node allows setting the `protocolId`
  const sponsorWallet = deriveSponsorWallet(
    config.nodeSettings.airnodeWalletMnemonic,
    sponsor,
    '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
  ).connect(provider);

  // Fetch sponsorWallet transaction count
  const [errorGetTransactionCount, transactionCount] = await retryGo(() =>
    provider.getTransactionCount(sponsorWallet.address, currentBlock)
  );
  if (errorGetTransactionCount || isNil(transactionCount)) {
    const message = 'Failed to fetch the sponsor wallet transaction count';
    const log = node.logger.pend('ERROR', message, errorGetTransactionCount);
    return [[log], null];
  }

  const message = `Sponsor wallet ${sponsorWallet.address.replace(
    sponsorWallet.address.substring(5, 38),
    '...'
  )} transaction count: ${transactionCount}`;
  const log = node.logger.pend('INFO', message, errorGetTransactionCount);
  return [[log], { sponsorWallet, transactionCount }];
};
