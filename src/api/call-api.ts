import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { Config } from '../types';
import { Endpoint } from '../validator';

export const callApi = async (
  config: Config,
  endpoint: Endpoint,
  parameters: node.ApiCallParameters
): Promise<node.LogsData<ethers.BigNumber | null>> => {
  const [logs, apiCallResponse] = await node.handlers.callApi({
    config,
    aggregatedApiCall: {
      type: 'http-gateway',
      parameters,
      ...endpoint,
    },
  });
  if (!apiCallResponse.success) {
    return [logs, null];
  }

  const [apiValue] = (apiCallResponse as node.HttpGatewayApiCallSuccessResponse).data.values;
  const messageApiValue = `API value: ${apiValue}`;
  const logApiValue = utils.logger.pend('DEBUG', messageApiValue);
  return [[...logs, logApiValue], ethers.BigNumber.from(apiValue)];
};
