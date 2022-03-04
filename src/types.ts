import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as ois from '@api3/airnode-ois';
import { ethers } from 'ethers';

export interface PriorityFee {
  readonly value: string;
  readonly unit?: 'wei' | 'kwei' | 'mwei' | 'gwei' | 'szabo' | 'finney' | 'ether';
}

export interface ChainOptions {
  readonly txType: 'legacy' | 'eip1559';
  readonly baseFeeMultiplier?: string;
  readonly priorityFee?: PriorityFee;
}

export interface ChainConfig extends node.ChainConfig {
  readonly contracts: node.ChainContracts & {
    readonly RrpBeaconServer?: string;
    readonly DapiServer?: string;
  };
  readonly options: ChainOptions;
}

export interface RrpBeaconServerKeeperTrigger {
  readonly chainIds: string[];
  readonly templateId: string;
  readonly templateParameters: abi.InputParameter[];
  readonly endpointId: string;
  readonly deviationPercentage: string;
  readonly keeperSponsor: string;
  readonly requestSponsor: string;
}

export interface Subscription {
  readonly chainId: string;
  readonly airnodeAddress: string;
  readonly templateId: string;
  readonly parameters: string;
  readonly conditions: string;
  readonly relayer: string;
  readonly sponsor: string;
  readonly requester: string;
  readonly fulfillFunctionId: string;
}

export interface Template {
  readonly endpointId: string;
  readonly templateParameters: string;
}

export interface Endpoint {
  readonly oisTitle: string;
  readonly endpointName: string;
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
  readonly endpoints: { [key: string]: Endpoint };
}

export interface CallApiOptions {
  oises: ois.OIS[];
  apiCredentials: node.ApiCredentials[];
  apiCallParameters: node.ApiCallParameters;
  oisTitle: string;
  endpointName: string;
}

export interface LogsAndApiValuesByBeaconId {
  [beaconId: string]: {
    logs: node.PendingLog[];
    apiValue: ethers.BigNumber | null;
  };
}

interface BaseState {
  config: Config;
  baseLogOptions: node.LogOptions;
}
export interface State extends BaseState {
  airnodeWallet: ethers.Wallet;
  subscriptions: FullSubscription[];
  apiValuesBySubscriptionId: { [subscriptionId: string]: ethers.BigNumber };
  providerStates: ProviderState<EVMProviderState>[];
}

export type ProviderState<T extends {}> = T &
  BaseState & {
    chainId: string;
    providerName: string;
  };
export interface EVMProviderState {
  provider: ethers.providers.Provider;
  contracts: { [name: string]: ethers.Contract };
  voidSigner: ethers.VoidSigner;
  currentBlock: number;
  gasTarget: node.GasTarget;
}

export interface FullSubscription extends Subscription {
  subscriptionId: string;
  template: Template;
  endpoint: Endpoint;
}
