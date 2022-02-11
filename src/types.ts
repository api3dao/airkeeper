import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as ois from '@api3/airnode-ois';
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

export interface Allocator {
  readonly address: string;
  readonly startIndex: number;
  readonly endIndex: number;
}

export interface PspChainConfig extends node.ChainConfig {
  readonly contracts: node.ChainContracts & {
    readonly AirnodeProtocol: string;
    readonly DapiServer: string;
  };
  readonly allocators: Allocator[];
}
export interface RrpBeaconServerKeeperTrigger {
  readonly chainIds: string[];
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
  readonly airnodeAddress?: string;
  readonly airnodeXpub?: string;
  readonly chains: ChainConfig[];
  readonly triggers: node.Triggers & {
    rrpBeaconServerKeeperJobs: RrpBeaconServerKeeperTrigger[];
  };
}

export interface PspTrigger {
  readonly subscriptionId: string;
  readonly endpointName: string;
  readonly oisTitle: string;
  readonly templateId: string;
  readonly templateParameters: abi.InputParameter[];
  readonly overrideParameters: abi.InputParameter[];
  readonly conditions: string;
  readonly relayer: string;
  readonly sponsor: string;
  readonly requester: string;
  readonly fulfillFunctionId: string;
}

export interface PspConfig {
  readonly chains: PspChainConfig[];
  readonly triggers: node.Triggers & {
    psp: PspTrigger[];
  };
}

export type Trigger = RrpBeaconServerKeeperTrigger | PspTrigger;

export interface CallApiOptions {
  airnodeAddress: string;
  oises: ois.OIS[];
  apiCredentials: node.ApiCredentials[];
  id: string;
  trigger: Trigger;
}

export interface ApiValuesById {
  readonly [id: string]: ethers.BigNumber | null;
}

export interface LogsAndApiValuesByBeaconId {
  [beaconId: string]: {
    logs: node.PendingLog[];
    apiValue: ethers.BigNumber | null;
  };
}
