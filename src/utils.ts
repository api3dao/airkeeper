import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { DEFAULT_RETRY_TIMEOUT_MS } from './constants';

function deriveWalletPathFromSponsorAddress(sponsorAddress: string, protocolId: string) {
  const sponsorAddressBN = ethers.BigNumber.from(ethers.utils.getAddress(sponsorAddress));
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${protocolId}/${paths.join('/')}`;
}

function deriveSponsorWallet(airnodeMnemonic: string, sponsorAddress: string, protocolId: string) {
  return ethers.Wallet.fromMnemonic(
    airnodeMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress, protocolId)}`
  );
}

const retryGo = <T>(fn: () => Promise<T>, options?: node.utils.PromiseOptions) =>
  node.utils.go(() => node.utils.retryOnTimeout(DEFAULT_RETRY_TIMEOUT_MS, fn), options);

export { deriveSponsorWallet, retryGo };
