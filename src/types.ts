import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { ChainConfig, Config, Endpoint, Subscription, Template } from './validator';

export interface LogsAndApiValuesByBeaconId {
  [beaconId: string]: {
    logs: utils.PendingLog[];
    apiValue: ethers.BigNumber | null;
  };
}

export interface BaseState {
  config: Config;
}
export interface State extends BaseState {
  groupedSubscriptions: GroupedSubscriptions[];
  apiValuesBySubscriptionId: { [subscriptionId: string]: ethers.BigNumber };
  providerStates: ProviderState<EVMBaseState>[];
}

export type ProviderState<T extends {}> = T & {
  chainId: string;
  providerName: string;
  providerUrl: string;
  chainConfig: ChainConfig;
};

export interface EVMBaseState {
  currentBlock: ethers.providers.Block;
  gasTarget: utils.GasTarget;
}

export interface EVMProviderState extends EVMBaseState {
  provider: ethers.providers.Provider;
  contracts: { [name: string]: ethers.Contract };
  voidSigner: ethers.VoidSigner;
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

export interface ProviderSponsorSubscriptionsState extends SponsorSubscriptions {
  providerState: ProviderState<EVMBaseState>;
}

export interface ProviderSponsorProcessSubscriptionsState extends SponsorSubscriptions {
  providerState: ProviderState<EVMProviderState & { airnodeWallet: ethers.Wallet }>;
}

export interface WorkerParameters {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  logOptions: utils.LogOptions;
  stage: string;
}
export type CallApiResult = node.LogsData<{
  templateId: string;
  apiValue: ethers.BigNumber | null;
  subscriptions: Id<Subscription>[];
}>;
