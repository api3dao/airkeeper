import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import * as ois from '@api3/airnode-ois';
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

//TODO: check if BuildRequestOptions from airnode can be used or this can be removed entirely
export interface CallApiOptions {
  oises: ois.OIS[];
  apiCredentials: node.ApiCredentials[];
  apiCallParameters: node.ApiCallParameters;
  oisTitle: string;
  endpointName: string;
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
  providerStates: ProviderState<EVMProviderState>[];
}

export type ProviderState<T extends {}> = T &
  BaseState & {
    airnodeWallet: ethers.Wallet;
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

export interface ProcessableSubscription extends CheckedSubscription {
  nonce: number;
}

export interface SponsorWalletTransactionCount {
  sponsorWallet: ethers.Wallet;
  transactionCount: number;
}

export interface SponsorWalletWithSubscriptions {
  subscriptions: ProcessableSubscription[];
  sponsorWallet: ethers.Wallet;
}
