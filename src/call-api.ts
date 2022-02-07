import * as abi from "@api3/airnode-abi";
import * as adapter from "@api3/airnode-adapter";
import * as node from "@api3/airnode-node";
import * as ois from "@api3/airnode-ois";
import { ethers } from "ethers";
import isNil from "lodash/isNil";
import { ApiValuesByBeaconId, RrpBeaconServerKeeperTrigger } from "./types";
import { retryGo } from "./utils";

export const readApiValue = async (
  airnodeAddress: string,
  oises: ois.OIS[],
  apiCredentials: node.ApiCredentials[],
  {
    oisTitle,
    endpointName,
    templateId,
    templateParameters,
    overrideParameters,
  }: RrpBeaconServerKeeperTrigger
): Promise<node.LogsData<ApiValuesByBeaconId>> => {
  const configParameters = [...templateParameters, ...overrideParameters];

  // Derive beaconId
  const encodedParameters = abi.encode(configParameters);
  const beaconId = ethers.utils.solidityKeccak256(
    ["bytes32", "bytes"],
    [templateId, encodedParameters]
  );

  // Verify templateId matches data in rrpBeaconServerKeeperJob
  const endpointId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ["string", "string"],
      [oisTitle, endpointName]
    )
  );
  const encodedTemplateParameters = abi.encode(templateParameters);
  const expectedTemplateId = node.evm.templates.getExpectedTemplateId({
    airnodeAddress,
    endpointId,
    encodedParameters: encodedTemplateParameters,
    id: templateId,
  });
  if (expectedTemplateId !== templateId) {
    const message = `templateId '${templateId}' does not match expected templateId '${expectedTemplateId}'`;
    const log = node.logger.pend("ERROR", message);
    return [[log], { [beaconId]: null }];
  }

  const configOis = oises.find((o) => o.title === oisTitle)!;
  const configEndpoint = configOis.endpoints.find(
    (e) => e.name === endpointName
  )!;
  const apiCallParameters = configParameters.reduce(
    (acc, p) => ({ ...acc, [p.name]: p.value }),
    {}
  );
  const reservedParameters =
    node.adapters.http.parameters.getReservedParameters(
      configEndpoint,
      apiCallParameters || {}
    );
  if (!reservedParameters._type) {
    const message = `reserved parameter '_type' is missing for endpoint: ${endpointName}`;
    const log = node.logger.pend("ERROR", message);
    return [[log], { [beaconId]: null }];
  }
  const sanitizedParameters: adapter.Parameters = node.utils.removeKeys(
    apiCallParameters || {},
    ois.RESERVED_PARAMETERS
  );
  const adapterApiCredentials = apiCredentials
    .filter((c) => c.oisTitle === oisTitle)
    .map((c) => node.utils.removeKey(c, "oisTitle"));

  const options: adapter.BuildRequestOptions = {
    ois: configOis,
    endpointName,
    parameters: sanitizedParameters,
    apiCredentials: adapterApiCredentials as adapter.ApiCredentials[],
    metadata: null,
  };

  // Call API
  const [errBuildAndExecuteRequest, apiResponse] = await retryGo(() =>
    adapter.buildAndExecuteRequest(options)
  );
  if (
    errBuildAndExecuteRequest ||
    isNil(apiResponse) ||
    isNil(apiResponse.data)
  ) {
    const message = `failed to fetch data from API for endpoint: ${endpointName}`;
    const log = node.logger.pend("ERROR", message, errBuildAndExecuteRequest);
    return [[log], { [beaconId]: null }];
  }
  const messageApiResponse = `API server response data: ${JSON.stringify(
    apiResponse.data
  )}`;
  const logApiResponse = node.logger.pend("DEBUG", messageApiResponse);

  // Extract API value
  try {
    const response = adapter.extractAndEncodeResponse(
      apiResponse!.data,
      reservedParameters as adapter.ReservedParameters
    );
    const apiValue = ethers.BigNumber.from(response.values[0].toString());
    const messageApiValue = `API value: ${apiValue.toString()}`;
    const logApiValue = node.logger.pend("INFO", messageApiValue);

    return [[logApiResponse, logApiValue], { [beaconId]: apiValue }];
  } catch (error) {
    const message = `failed to extract or encode value from API response: ${JSON.stringify(
      apiResponse.data
    )}`;
    const log = node.logger.pend("ERROR", message, error as any);
    return [[log], { [beaconId]: null }];
  }
};
