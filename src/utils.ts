import fs from 'fs';
import path from 'path';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';

export const DEFAULT_RETRY_TIMEOUT_MS = 5_000;

const loadNodeConfig = () => {
  // This file must be the same as the one used by the @api3/airnode-node
  const nodeConfigPath = path.resolve(__dirname, '..', '..', 'config', `config.json`);

  const { config, shouldSkipValidation, validationOutput } = node.config.parseConfig(nodeConfigPath, process.env, true);

  // TODO: Log debug that validation is skipped
  if (shouldSkipValidation) return config;
  if (!validationOutput.valid) {
    throw new Error(`Invalid Airnode configuration file: ${JSON.stringify(validationOutput.messages, null, 2)}`);
  }
  // TODO: Log validation warnings - currently not possible since we have troubles constructing logger options

  return config;
};

const parseConfig = <T>(filename: string): T => {
  const configPath = path.resolve(__dirname, '..', '..', 'config', `${filename}.json`);
  return JSON.parse(fs.readFileSync(configPath, 'utf8'));
};

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

export { loadNodeConfig, parseConfig, deriveSponsorWallet, retryGo };
