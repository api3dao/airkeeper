export interface ChainConfig {
  readonly contracts: { readonly RrpBeaconServer: string };
}

export interface RrpBeaconServerKeeperTrigger {
  readonly templateId: string;
  readonly endpointName: string;
  readonly oisTitle: string;
  readonly deviationPercentage: string;
  readonly keeperSponsor: string;
  readonly requestSponsor: string;
}

export interface Config {
  readonly chains: ChainConfig[];
  readonly triggers: {
    rrpBeaconServerKeeperJobs: RrpBeaconServerKeeperTrigger[];
  };
}
