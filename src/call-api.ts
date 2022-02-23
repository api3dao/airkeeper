import * as abi from '@api3/airnode-abi';
import * as adapter from '@api3/airnode-adapter';
import * as node from '@api3/airnode-node';
import * as ois from '@api3/airnode-ois';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { ApiValuesById, CallApiOptions } from './types';
import { retryGo } from './utils';

export const callApi = async ({
  airnodeAddress,
  oises,
  apiCredentials,
  id,
  templateId,
  oisTitle,
  endpointName,
  endpointId,
  templateParameters,
  overrideParameters,
}: CallApiOptions): Promise<node.LogsData<ApiValuesById>> => {
  const configParameters = [...templateParameters, ...overrideParameters];

  // Derive endpointId
  const expectedEndpointId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['string', 'string'], [oisTitle, endpointName])
  );
  // Verify endpointId
  if (endpointId && expectedEndpointId !== endpointId) {
    const message = `endpointId '${endpointId}' does not match expected endpointId '${expectedEndpointId}'`;
    const log = node.logger.pend('ERROR', message);
    return [[log], { [id]: null }];
  }

  // Encode template parameters
  let encodedParameters;
  try {
    encodedParameters = abi.encode(templateParameters);
  } catch (error) {
    const message = `failed to encode template parameters '${JSON.stringify(templateParameters)}'`;
    const log = node.logger.pend('ERROR', message);
    return [[log], { [id]: null }];
  }
  // Derive templateId
  const expectedTemplateId = node.evm.templates.getExpectedTemplateId({
    airnodeAddress,
    endpointId: expectedEndpointId,
    encodedParameters,
    id: templateId,
  });
  // Verify templateId
  if (expectedTemplateId !== templateId) {
    const message = `templateId '${templateId}' does not match expected templateId '${expectedTemplateId}'`;
    const log = node.logger.pend('ERROR', message);
    return [[log], { [id]: null }];
  }

  const configOis = oises.find((o) => o.title === oisTitle)!;
  const configEndpoint = configOis.endpoints.find((e) => e.name === endpointName)!;
  const apiCallParameters = configParameters.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {});
  const reservedParameters = node.adapters.http.parameters.getReservedParameters(
    configEndpoint,
    apiCallParameters || {}
  );
  if (!reservedParameters._type) {
    const message = `reserved parameter '_type' is missing for endpoint: ${endpointName}`;
    const log = node.logger.pend('ERROR', message);
    return [[log], { [id]: null }];
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
    return [[log], { [id]: null }];
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

    return [[logApiResponse, logApiValue], { [id]: apiValue }];
  } catch (error) {
    const message = `failed to extract or encode value from API response: ${JSON.stringify(apiResponse.data)}`;
    const log = node.logger.pend('ERROR', message, error as any);
    return [[log], { [id]: null }];
  }
};
