import * as adapter from '@api3/airnode-adapter';
import * as node from '@api3/airnode-node';
import * as ois from '@api3/airnode-ois';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { CallApiOptions } from '../types';
import { retryGo } from '../utils';

export const callApi = async ({
  oises,
  apiCredentials,
  apiCallParameters,
  oisTitle,
  endpointName,
}: CallApiOptions): Promise<node.LogsData<ethers.BigNumber | null>> => {
  const configOis = oises.find((o) => o.title === oisTitle)!;
  const configEndpoint = configOis.endpoints.find((e) => e.name === endpointName)!;
  const reservedParameters = node.adapters.http.parameters.getReservedParameters(
    configEndpoint,
    apiCallParameters || {}
  );
  if (!reservedParameters._type) {
    const message = `reserved parameter '_type' is missing for endpoint: ${endpointName}`;
    const log = node.logger.pend('ERROR', message);
    return [[log], null];
  }

  // Remove reserved parameters
  const sanitizedParameters: adapter.Parameters = node.utils.removeKeys(
    apiCallParameters || {},
    ois.RESERVED_PARAMETERS
  );

  // Remove oisTitle from credentials
  const adapterApiCredentials = apiCredentials
    .filter((c) => c.oisTitle === oisTitle)
    .map((c) => node.utils.removeKey(c, 'oisTitle'));

  const options: adapter.BuildRequestOptions = {
    ois: configOis,
    endpointName,
    parameters: sanitizedParameters,
    apiCredentials: adapterApiCredentials as adapter.ApiCredentials[],
    metadata: null,
  };

  // Call API
  const [errBuildAndExecuteRequest, apiResponse] = await retryGo(() => adapter.buildAndExecuteRequest(options));
  if (errBuildAndExecuteRequest || isNil(apiResponse) || isNil(apiResponse.data)) {
    const message = `failed to fetch data from API for endpoint: ${endpointName}`;
    const log = node.logger.pend('ERROR', message, errBuildAndExecuteRequest);
    return [[log], null];
  }
  const messageApiResponse = `API server response data: ${JSON.stringify(apiResponse.data)}`;
  const logApiResponse = node.logger.pend('DEBUG', messageApiResponse);

  // Extract API value
  try {
    const response = adapter.extractAndEncodeResponse(
      apiResponse!.data,
      reservedParameters as adapter.ReservedParameters
    );
    const apiValue = ethers.BigNumber.from(response.values[0].toString());
    const messageApiValue = `API value: ${apiValue.toString()}`;
    const logApiValue = node.logger.pend('INFO', messageApiValue);

    return [[logApiResponse, logApiValue], apiValue];
  } catch (error) {
    const message = `failed to extract or encode value from API response: ${JSON.stringify(apiResponse.data)}`;
    const log = node.logger.pend('ERROR', message, error as any);
    return [[log], null];
  }
};
