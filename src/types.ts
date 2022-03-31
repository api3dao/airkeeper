import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import {
  Triggers,
  Subscription,
  Subscriptions,
  Template,
  Templates,
  Endpoint,
  Endpoints,
  AirkeeperChainContracts,
  AirkeeperChainConfig,
} from './validator';

export interface ChainConfig extends node.ChainConfig {
  readonly contracts: node.ChainContracts & AirkeeperChainContracts;
  readonly options: node.ChainOptions;
}

export interface Config extends node.Config {
  readonly airnodeAddress?: string;
  readonly airnodeXpub?: string;
  readonly chains: (ChainConfig & AirkeeperChainConfig)[];
  readonly triggers: node.Triggers & Triggers;
  readonly subscriptions: Subscriptions;
  readonly templates: Templates;
  readonly endpoints: Endpoints;
}

export interface LogsAndApiValuesByBeaconId {
  [beaconId: string]: {
    logs: utils.PendingLog[];
    apiValue: ethers.BigNumber | null;
  };
}

export interface BaseState {
  config: Config;
  baseLogOptions: utils.LogOptions;
}
export interface State extends BaseState {
  groupedSubscriptions: GroupedSubscriptions[];
  apiValuesBySubscriptionId: { [subscriptionId: string]: ethers.BigNumber };
  groupedProviders: GroupedProvider[];
}

export type GroupedProvider = {
  chainId: string;
  providerName: string;
  providerUrl: string;
  chainConfig: ChainConfig & AirkeeperChainConfig;
};

export type ProviderState<T extends {}> = T &
  GroupedProvider & {
    airnodeWallet: ethers.Wallet;
  };

export interface EVMProviderState {
  provider: ethers.providers.Provider;
  contracts: { [name: string]: ethers.Contract };
  voidSigner: ethers.VoidSigner;
  currentBlock: number;
  gasTarget: node.GasTarget;
}

export type Id<T> = T & {
  id: string;
};

export interface GroupedSubscriptions {
  subscriptions: Id<Subscription>[];
  template: Id<Template>;
  endpoint: Id<Endpoint>;
}

export interface CheckedSubscription extends Id<Subscription> {
  apiValue: ethers.BigNumber;
}

export interface SponsorWalletTransactionCount {
  sponsorWallet: ethers.Wallet;
  transactionCount: number;
}

export interface SponsorSubscriptions {
  sponsorAddress: string;
  subscriptions: Id<CheckedSubscription>[];
}

export interface ProviderSponsorSubscriptions extends SponsorSubscriptions {
  providerGroup: GroupedProvider;
}

export interface ProviderSponsorSubscriptionsState extends SponsorSubscriptions {
  providerState: ProviderState<EVMProviderState>;
}

export interface AWSHandlerResponse {
  statusCode: number;
  ok: boolean;
  message: string;
}
