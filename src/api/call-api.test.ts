import { readFileSync } from 'fs';
import { join } from 'path';
import * as abi from '@api3/airnode-abi';
import * as adapter from '@api3/airnode-adapter';
import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { callApi } from './call-api';
import { AirkeeperConfig } from '../validator';
import { mergeConfigs } from '../config';

describe('callApi', () => {
  const airnodeConfig: node.Config = JSON.parse(
    readFileSync(join(__dirname, '../../config/config.example.json')).toString()
  );
  const airkeeperConfig: AirkeeperConfig = JSON.parse(
    readFileSync(join(__dirname, '../../config/airkeeper.example.json')).toString()
  );
  const config = mergeConfigs(airnodeConfig, airkeeperConfig);
  const airnodeAddress = airkeeperConfig.airnodeAddress;
  if (airkeeperConfig.airnodeAddress && airkeeperConfig.airnodeAddress !== airnodeAddress) {
    throw new Error(`xpub does not belong to Airnode: ${airnodeAddress}`);
  }
  const endpointId = Object.keys(airkeeperConfig.endpoints)[0];
  const templateParameters =
    airkeeperConfig.templates['0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa'].templateParameters;
  const apiCallParameters = abi.decode(templateParameters);
  const requestId = utils.randomHexString(16);
  const aggregatedApiCall: node.AggregatedApiCall = {
    type: 'beacon',
    id: requestId,
    airnodeAddress,
    endpointId,
    endpointName: airkeeperConfig.endpoints[endpointId].endpointName,
    oisTitle: airkeeperConfig.endpoints[endpointId].oisTitle,
    parameters: apiCallParameters,
  };

  it('calls the adapter with the given parameters', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { success: true, result: '723.392028' };
    spy.mockResolvedValueOnce({
      data: apiResponse,
    });

    const [logs, res] = await callApi({ config, aggregatedApiCall });
    console.log('logs', logs);
    console.log('res', res);

    expect(logs).toHaveLength(0);
    expect(res).toBeDefined();
    expect(res).toEqual(ethers.BigNumber.from(723392028));
    expect(spy).toHaveBeenCalledTimes(1);
    // expect(spy).toHaveBeenCalledWith(config);
  });

  it("returns null if reserved parameter '_type' is missing", async () => {
    const oisesWithoutType = airnodeConfig.ois.map((o) => ({
      ...o,
      endpoints: o.endpoints.map((e) => ({
        ...e,
        reservedParameters: e.reservedParameters.filter((r) => r.name !== '_type'),
      })),
    }));

    const [logs, res] = await callApi({
      config: { ...config, ois: oisesWithoutType },
      aggregatedApiCall,
    });

    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          level: 'ERROR',
          message: "Cannot read property 'length' of undefined",
        },
        {
          error: "Cannot read property 'length' of undefined",
          level: 'ERROR',
          message:
            'Failed to extract or encode value from API response: {"success":false,"errorMessage":"Cannot read property \'length\' of undefined"}',
        },
      ])
    );
    expect(res).toEqual(null);
  });

  it('returns an error if the API call fails to execute', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;
    const error = new Error('Network is down');
    spy.mockRejectedValueOnce(error);

    const [logs, res] = await callApi({ config, aggregatedApiCall });

    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          error,
          level: 'ERROR',
          message: 'Failed to call Endpoint:convertToUSD',
        },
        {
          error: 'API call failed',
          level: 'ERROR',
          message:
            'Failed to extract or encode value from API response: {"success":false,"errorMessage":"API call failed"}',
        },
      ])
    );
    expect(res).toEqual(null);
    expect(spy).toHaveBeenCalledTimes(1);
    // expect(spy).toHaveBeenCalledWith(config);
  });

  it('returns an error if the API call fails to extract and encode response', async () => {
    const buildAndExecuteRequestSpy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;
    const apiResponse = { success: true, result: '723.392028' };
    buildAndExecuteRequestSpy.mockResolvedValueOnce({
      data: apiResponse,
    });

    const extractAndEncodeResponseSpy = jest.spyOn(adapter, 'extractAndEncodeResponse');
    const error = new Error('Unexpected error');
    extractAndEncodeResponseSpy.mockImplementationOnce(() => {
      throw error;
    });

    const [logs, res] = await callApi({ config, aggregatedApiCall });

    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        { level: 'ERROR', message: 'Unexpected error' },
        // {
        //   error,
        //   level: 'ERROR',
        //   message: `Failed to extract or encode value from API response: ${JSON.stringify(apiResponse)}`,
        // },
      ])
    );
    expect(res).toEqual(null);
    expect(buildAndExecuteRequestSpy).toHaveBeenCalledTimes(1);
    // const { securitySchemeName, securitySchemeValue } = apiCredentials[0];
    // expect(buildAndExecuteRequestSpy).toHaveBeenCalledWith(config);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledWith(apiResponse, expect.any(Object));
  });
});
