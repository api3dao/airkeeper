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
  type: 'local' | 'aws';
  stage: string;
}): Promise<any> => {
  switch (type) {
    case 'local':
      return new Promise((resolve, reject) =>
        processSubscriptionsHandler({ providerSponsorSubscriptions, baseLogOptions }).then(resolve).catch(reject)
      );
    case 'aws':
      return aws.spawn({ providerSponsorSubscriptions, baseLogOptions, stage });
  }
};
