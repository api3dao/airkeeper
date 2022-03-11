import fs from 'fs';
import path from 'path';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { DEFAULT_RETRY_TIMEOUT_MS } from './constants';
import { validateConfig, configSchema, Config } from './validator';

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

const loadAirkeeperConfig = (): Config => {
  const configPath = path.resolve(__dirname, '..', '..', 'config', `airkeeper.json`);
  const airkeeperConfig: Config = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const validationOutput = validateConfig(configSchema, airkeeperConfig);
  if (!validationOutput.success) {
    throw new Error(`Invalid Airkeeper configuration file: ${JSON.stringify(validationOutput.error, null, 2)}`);
  }

  return validationOutput.data;
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

export { loadNodeConfig, loadAirkeeperConfig, deriveSponsorWallet, retryGo };
