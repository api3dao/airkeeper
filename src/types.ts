import * as node from "@api3/airnode-node";

export interface ChainConfig extends node.ChainConfig {
  readonly contracts: node.ChainContracts & {
    readonly RrpBeaconServer: string;
  };
}

export interface RrpBeaconServerKeeperTrigger {
  readonly templateId: string;
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
