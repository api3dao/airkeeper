import { ethers } from 'ethers';

const deriveWalletPathFromSponsorAddress = (sponsorAddress: string, protocolId: string) => {
  const sponsorAddressBN = ethers.BigNumber.from(ethers.utils.getAddress(sponsorAddress));
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${protocolId}/${paths.join('/')}`;
};

export const deriveSponsorWallet = (airnodeMnemonic: string, sponsorAddress: string, protocolId: string) =>
  ethers.Wallet.fromMnemonic(
    airnodeMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress, protocolId)}`
  );

export const shortenAddress = (address: string) => address.replace(address.substring(5, 38), '...');
