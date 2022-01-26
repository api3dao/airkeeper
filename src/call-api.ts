import * as abi from "@api3/airnode-abi";
import * as adapter from "@api3/airnode-adapter";
import * as node from "@api3/airnode-node";
import * as ois from "@api3/airnode-ois";
import * as ethers from "ethers";
import isNil from "lodash/isNil";
import { ApiValuesByBeaconId, RrpBeaconServerKeeperTrigger } from "./types";
import { retryGo } from "./utils";

export const readApiValue = async (
  airnodeHDNode: ethers.utils.HDNode,
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
  let apiValue: ethers.BigNumber | null = null;
  const configParameters = [...templateParameters, ...overrideParameters];

  // Derive beaconId
  const encodedParameters = abi.encode(configParameters);
  const beaconId = ethers.utils.solidityKeccak256(
    ["bytes32", "bytes"],
    [templateId, encodedParameters]
  );

  // Verify templateId matches data in rrpBeaconServerKeeperJob
  const airnodeAddress = airnodeHDNode.derivePath(
    ethers.utils.defaultPath
  ).address;
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
    return [
      [
        node.logger.pend(
          "ERROR",
          `templateId '${templateId}' does not match expected templateId '${expectedTemplateId}'`
        ),
      ],
      { [beaconId]: apiValue },
    ];
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
    return [
      [
        node.logger.pend(
          "ERROR",
          `reserved parameter 'type' is missing for endpoint: ${endpointName}`
        ),
      ],
      { [beaconId]: apiValue },
    ];
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
    return [
      [
        node.logger.pend(
          "ERROR",
          `failed to fetch data from API for endpoint: ${endpointName}`,
          errBuildAndExecuteRequest
        ),
      ],
      { [beaconId]: apiValue },
    ];
  }
  const logApiResponse = node.logger.pend(
    "INFO",
    `API server response data: ${JSON.stringify(apiResponse.data)}`
  );

  // Extract API value
  try {
    const response = adapter.extractAndEncodeResponse(
      apiResponse!.data,
      reservedParameters as adapter.ReservedParameters
    );
    apiValue = ethers.BigNumber.from(response.values[0].toString());
  } catch (error) {
    return [
      [
        node.logger.pend(
          "ERROR",
          `failed to extract or encode value from API response: ${JSON.stringify(
            apiResponse.data
          )}`,
          error as any
        ),
      ],
      { [beaconId]: apiValue },
    ];
  }
  const logApiValue = node.logger.pend(
    "INFO",
    `API value: ${apiValue.toString()}`
  );

  return [[logApiResponse, logApiValue], { [beaconId]: apiValue }];
};
