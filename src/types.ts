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
    readonly AirnodeProtocol: string;
    readonly DapiServer: string;
  };
  // readonly allocators: Allocator[];
  readonly options: ChainOptions;
}

// export interface Allocator {
//   readonly address: string;
//   readonly startIndex: number;
//   readonly endIndex: number;
// }
export interface RrpBeaconServerKeeperTrigger {
  readonly chainIds: string[];
  readonly templateId: string;
  readonly overrideParameters: abi.InputParameter[];
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
    'proto-psp': string[];
  };
  readonly subscriptions: { [key: string]: Subscription };
  readonly templates: { [key: string]: Template };
}

export interface Subscription {
  readonly chainId: string;
  readonly airnodeAddress: string;
  readonly templateId: string;
  readonly overrideParameters: abi.InputParameter[];
  readonly parameters: string;
  readonly conditions: string;
  readonly relayer: string;
  readonly sponsor: string;
  readonly requester: string;
  readonly fulfillFunctionId: string;
}

export interface Template {
  readonly oisTitle: string;
  readonly endpointName: string;
  readonly endpointId: string;
  readonly templateParameters: abi.InputParameter[];
}

export interface CallApiOptions {
  airnodeAddress: string;
  oises: ois.OIS[];
  apiCredentials: node.ApiCredentials[];
  id: string;
  templateId: string;
  oisTitle: string;
  endpointName: string;
  endpointId?: string;
  templateParameters: abi.InputParameter[];
  overrideParameters: abi.InputParameter[];
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
