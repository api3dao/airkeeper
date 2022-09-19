import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { Endpoint } from '../validator';

export const callApi = async (
  config: node.HttpApiCallConfig,
  endpoint: Endpoint,
  parameters: node.ApiCallParameters
): Promise<node.LogsData<ethers.BigNumber | null>> => {
  const aggregatedApiCall: node.BaseAggregatedApiCall = {
    parameters,
    ...endpoint,
  };
  const [logs, apiCallResponse] = await node.api.callApi({
    type: 'http-gateway',
    config,
    aggregatedApiCall,
  });
  if (!apiCallResponse.success) {
    return [logs, null];
  }

  const [apiValue] = (apiCallResponse as node.HttpGatewayApiCallSuccessResponse).data.values;
  const messageApiValue = `API value: ${apiValue}`;
  const logApiValue = utils.logger.pend('DEBUG', messageApiValue);
  return [[...logs, logApiValue], ethers.BigNumber.from(apiValue)];
};
