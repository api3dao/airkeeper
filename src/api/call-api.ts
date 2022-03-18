import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { Config } from '../types';

//TODO: check if Airkeeper's merged Config is ok or we should be using node.Config type
export const callApi = async (payload: {
  config: Config;
  aggregatedApiCall: node.AggregatedApiCall;
}): Promise<node.LogsData<ethers.BigNumber | null>> => {
  const [logs, apiCallResponse] = await node.handlers.callApi(payload);
  if (!apiCallResponse.success) {
    // TODO: check error message
    const message = `Failed to extract or encode value from API response: ${JSON.stringify(apiCallResponse)}`;
    const log = utils.logger.pend('ERROR', message, apiCallResponse.errorMessage as any);
    return [[...logs, log], null];
  }

  const parsedData = JSON.parse(apiCallResponse.value);
  const apiValue = ethers.BigNumber.from(parsedData.values[0].toString());
  return [logs, apiValue];
};
