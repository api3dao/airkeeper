import * as utils from '@api3/airnode-utilities';
import * as aws from './aws';
import * as local from './local';
import { ProviderSponsorSubscriptions } from '../types';

export const spawn = ({
  providerSponsorSubscriptions,
  baseLogOptions,
  type,
  stage,
}: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptions;
  baseLogOptions: utils.LogOptions;
  type: 'local' | 'aws' | 'gcp';
  stage: string;
}): Promise<string> => {
  switch (type) {
    case 'local':
      return local.spawn({ providerSponsorSubscriptions, baseLogOptions, stage });
    case 'aws':
      return aws.spawn({ providerSponsorSubscriptions, baseLogOptions, stage });
    case 'gcp':
      return new Promise((_, reject) => reject('GCP is not supported'));
  }
};
