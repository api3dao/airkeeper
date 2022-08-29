import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { SponsorWalletTransactionCount } from '../types';
import { TIMEOUT_MS, RETRIES, PROTOCOL_ID_PSP } from '../constants';
import { shortenAddress } from '../wallet';

export const getSponsorWalletAndTransactionCount = async (
  airnodeWallet: ethers.Wallet,
  provider: ethers.providers.Provider,
  currentBlockNumber: number,
  sponsor: string
): Promise<node.LogsData<SponsorWalletTransactionCount | null>> => {
  // Derive sponsorWallet address
  const sponsorWallet = node.evm
    .deriveSponsorWalletFromMnemonic(airnodeWallet.mnemonic.phrase, sponsor, PROTOCOL_ID_PSP)
    .connect(provider);

  // Fetch sponsorWallet transaction count
  const transactionCount = await go(() => provider.getTransactionCount(sponsorWallet.address, currentBlockNumber), {
    attemptTimeoutMs: TIMEOUT_MS,
    retries: RETRIES,
  });
  if (!transactionCount.success) {
    const message = 'Failed to fetch the sponsor wallet transaction count';
    const log = utils.logger.pend('ERROR', message, transactionCount.error);
    return [[log], null];
  }

  const message = `Sponsor wallet ${shortenAddress(sponsorWallet.address)} transaction count: ${transactionCount.data}`;
  const log = utils.logger.pend('INFO', message);
  return [[log], { sponsorWallet, transactionCount: transactionCount.data }];
};
