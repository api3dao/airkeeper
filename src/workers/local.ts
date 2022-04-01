import { processSubscriptionsHandler } from '../handlers';
import { WorkerParameters } from '../types';

export const spawn = async ({ providerSponsorSubscriptions, baseLogOptions }: WorkerParameters): Promise<string> =>
  new Promise((resolve, reject) => {
    processSubscriptionsHandler({ providerSponsorSubscriptions, baseLogOptions }).then((data) => {
      if (!data.ok) {
        reject(data.message);
      }
      resolve(data.message);
    });
  });
