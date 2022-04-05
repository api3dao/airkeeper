import AWS from 'aws-sdk';
import { WorkerParameters, AWSHandlerResponse } from '../types';

export const spawn = async ({ providerSponsorSubscriptions, baseLogOptions, stage }: WorkerParameters): Promise<any> =>
  // lambda.invoke is synchronous so we need to wrap this in a promise
  new Promise((resolve, reject) => {
    // Uses the current region by default
    const lambda = new AWS.Lambda();

    // AWS doesn't allow uppercase letters in lambda function names
    const resolvedName = `airkeeper-${stage}-process-subscriptions`;

    const options = {
      FunctionName: resolvedName,
      Payload: JSON.stringify({ providerSponsorSubscriptions, baseLogOptions }),
    };
    lambda.invoke(options, (err, data) => {
      // Reject invoke and (unhandled) handler errors
      if (err || data.FunctionError) {
        reject(err || data.FunctionError);
        return;
      }

      const parsedData: AWSHandlerResponse = JSON.parse(data.Payload as string);

      // Reject non-ok results
      if (!parsedData.ok) {
        reject(parsedData);
        return;
      }

      resolve(parsedData);
    });
  });