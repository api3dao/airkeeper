import * as fs from "fs";
import * as path from "path";
import * as ethers from "ethers";
import * as node from "@api3/airnode-node";
import { Config } from "./types";

const loadAirkeeperConfig = (): Config => {
  const configPath = path.resolve(`${__dirname}/../config/airkeeper.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
};

const deriveKeeperSponsorWallet = (
  airnodeHdNode: ethers.utils.HDNode,
  sponsorAddress: string,
  provider: ethers.providers.Provider
): ethers.Wallet => {
  const sponsorWalletHdNode = airnodeHdNode.derivePath(
    `m/44'/60'/12345'/${node.evm.deriveWalletPathFromSponsorAddress(
      sponsorAddress
    )}`
  );
  return new ethers.Wallet(sponsorWalletHdNode.privateKey).connect(provider);
};

export { loadAirkeeperConfig, deriveKeeperSponsorWallet };
