import * as node from "@api3/airnode-node";
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { Config } from "./types";

export const DEFAULT_RETRY_TIMEOUT_MS = 5_000;

const parseAirkeeperConfig = (): Config => {
  const configPath = path.resolve(`${__dirname}/../../config/airkeeper.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
};

const deriveKeeperWalletPathFromSponsorAddress = (
  sponsorAddress: string
): string => {
  const sponsorAddressBN = ethers.BigNumber.from(
    ethers.utils.getAddress(sponsorAddress)
  );
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `12345/${paths.join("/")}`;
};

const deriveKeeperSponsorWallet = (
  airnodeHdNode: ethers.utils.HDNode,
  sponsorAddress: string,
  provider: ethers.providers.Provider
): ethers.Wallet => {
  const sponsorWalletHdNode = airnodeHdNode.derivePath(
    `m/44'/60'/0'/${deriveKeeperWalletPathFromSponsorAddress(sponsorAddress)}`
  );
  return new ethers.Wallet(sponsorWalletHdNode.privateKey).connect(provider);
};

const retryGo = <T>(
  fn: () => Promise<T>,
  options?: node.utils.PromiseOptions
) =>
  node.utils.go(
    () => node.utils.retryOnTimeout(DEFAULT_RETRY_TIMEOUT_MS, fn),
    options
  );

export { parseAirkeeperConfig, deriveKeeperSponsorWallet, retryGo };
