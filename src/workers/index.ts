import * as utils from '@api3/airnode-utilities';
import * as aws from './aws';
import { processSubscriptionsHandler } from '../handlers';
import { ProviderSponsorSubscriptionsState } from '../types';

export const spawn = ({
  providerSponsorSubscriptions,
  logOptions: logOptions,
  type,
  stage,
}: {
  providerSponsorSubscriptions: ProviderSponsorSubscriptionsState;
  logOptions: utils.LogOptions;
  type: 'local' | 'aws';
  stage: string;
}): Promise<any> => {
  switch (type) {
    case 'local':
      return new Promise((resolve, reject) =>
        processSubscriptionsHandler({ providerSponsorSubscriptions, logOptions }).then(resolve).catch(reject)
      );
    case 'aws':
      return aws.spawn({ providerSponsorSubscriptions, logOptions, stage });
  }
};
