import AWS from 'aws-sdk';
import { WorkerParameters } from '../types';

export const spawn = async ({ providerSponsorSubscriptions, logOptions, stage }: WorkerParameters): Promise<void> =>
  // lambda.invoke is synchronous so we need to wrap this in a promise
  new Promise((resolve, reject) => {
    // Uses the current region by default
    const lambda = new AWS.Lambda();

    // AWS doesn't allow uppercase letters in lambda function names
    const resolvedName = `airkeeper-${stage}-process-subscriptions`;

    const options: AWS.Lambda.InvocationRequest = {
      FunctionName: resolvedName,
      Payload: JSON.stringify({ providerSponsorSubscriptions, logOptions }),
    };
    lambda.invoke(options, (err, data) => {
      // Reject invoke and (unhandled) handler errors
      if (err || data.FunctionError) {
        reject(err || data.FunctionError);
        return;
      }

      resolve();
    });
  });
