import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';

export interface ChainOptions {
  readonly txType: 'legacy' | 'eip1559';
  readonly baseFeeMultiplier?: string;
  readonly priorityFee?: PriorityFee;
}

export interface FetchOptions {
  readonly provider: ethers.providers.JsonRpcProvider;
  readonly chainOptions: ChainOptions;
}

export interface PriorityFee {
  readonly value: string;
  readonly unit?: 'wei' | 'kwei' | 'mwei' | 'gwei' | 'szabo' | 'finney' | 'ether';
}

export interface GasTarget {
  readonly maxPriorityFeePerGas?: ethers.BigNumber;
  readonly maxFeePerGas?: ethers.BigNumber;
  readonly gasPrice?: ethers.BigNumber;
}

export interface ChainConfig extends node.ChainConfig {
  readonly contracts: node.ChainContracts & {
    readonly RrpBeaconServer: string;
  };
  readonly options: ChainOptions;
}

export interface RrpBeaconServerKeeperTrigger {
  readonly templateId: string;
  readonly templateParameters: abi.InputParameter[];
  readonly overrideParameters: abi.InputParameter[];
  readonly endpointName: string;
  readonly oisTitle: string;
  readonly deviationPercentage: string;
  readonly keeperSponsor: string;
  readonly requestSponsor: string;
}

export interface Config extends node.Config {
  readonly chains: ChainConfig[];
  readonly triggers: node.Triggers & {
    rrpBeaconServerKeeperJobs: RrpBeaconServerKeeperTrigger[];
  };
}

export interface ApiValuesByBeaconId {
  readonly [beaconId: string]: ethers.BigNumber | null;
}

export interface LogsAndApiValuesByBeaconId {
  [beaconId: string]: {
    logs: node.PendingLog[];
    apiValue: ethers.BigNumber | null;
  };
}
