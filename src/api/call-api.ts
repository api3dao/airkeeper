import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { Config } from '../types';

//TODO: check if Airkeeper's merged Config is ok or we should be using node.Config type
export const callApi = async (
  config: Config,
  callApiOptions: {
    id: string;
    airnodeAddress: string;
    endpointId: string;
    endpointName: string;
    oisTitle: string;
    parameters: node.ApiCallParameters;
  }
): Promise<node.LogsData<ethers.BigNumber | null>> => {
  const [logs, apiCallResponse] = await node.handlers.callApi({
    config,
    aggregatedApiCall: { type: 'http-gateway', ...callApiOptions },
  });
  if (!apiCallResponse.success) {
    return [logs, null];
  }

  const parsedData = JSON.parse(apiCallResponse.value);
  const apiValue = ethers.BigNumber.from(parsedData.values[0].toString());
  return [logs, apiValue];
};
