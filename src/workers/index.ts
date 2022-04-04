import * as utils from '@api3/airnode-utilities';
import * as aws from './aws';
import { processSubscriptionsHandler } from '../handlers';
import { ProviderSponsorSubscriptionsState } from '../types';

export const spawn = ({
  providerSponsorSubscriptions,
  baseLogOptions,
  type,
  stage,
}: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  baseLogOptions: utils.LogOptions;
  type: 'local' | 'aws' | 'gcp';
  stage: string;
}): Promise<string> => {
  switch (type) {
    case 'local':
      return new Promise((resolve, reject) => {
        processSubscriptionsHandler({ providerSponsorSubscriptions, baseLogOptions }).then((data) => {
          if (!data.ok) {
            reject(data.message);
          }
          resolve(data.message);
        });
      });
    case 'aws':
      return aws.spawn({ providerSponsorSubscriptions, baseLogOptions, stage });
    case 'gcp':
      return new Promise((_, reject) => reject('GCP is not supported'));
  }
};
