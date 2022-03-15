import * as node from '@api3/airnode-node';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { SponsorWalletTransactionCount } from '../types';
import { DEFAULT_RETRY_TIMEOUT_MS } from '../constants';

import { deriveSponsorWallet } from '../wallet';

export const getSponsorWalletAndTransactionCount = async (
  airnodeWallet: ethers.Wallet,
  provider: ethers.providers.Provider,
  currentBlock: number,
  sponsor: string
): Promise<node.LogsData<SponsorWalletTransactionCount | null>> => {
  // Derive sponsorWallet address
  // TODO: switch to node.evm.deriveSponsorWallet when @api3/airnode-node allows setting the `protocolId`
  const sponsorWallet = deriveSponsorWallet(
    airnodeWallet.mnemonic.phrase,
    sponsor,
    '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
  ).connect(provider);

  // Fetch sponsorWallet transaction count
  const transactionCount = await go(() => provider.getTransactionCount(sponsorWallet.address, currentBlock), {
    timeoutMs: DEFAULT_RETRY_TIMEOUT_MS,
  });
  if (!transactionCount.success) {
    const message = 'Failed to fetch the sponsor wallet transaction count';
    const log = node.logger.pend('ERROR', message, transactionCount.error);
    return [[log], null];
  }

  const message = `Sponsor wallet ${sponsorWallet.address.replace(
    sponsorWallet.address.substring(5, 38),
    '...'
  )} transaction count: ${transactionCount}`;
  const log = node.logger.pend('INFO', message);
  return [[log], { sponsorWallet, transactionCount: transactionCount.data }];
};
