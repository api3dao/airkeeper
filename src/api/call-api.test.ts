import { readFileSync } from 'fs';
import { join } from 'path';
import * as abi from '@api3/airnode-abi';
import * as adapter from '@api3/airnode-adapter';
import { ethers } from 'ethers';
import { callApi } from './call-api';
import { Config } from '../validator';
import { interpolateSecrets } from '../config';

const envVariables = {
  AIRNODE_WALLET_MNEMONIC: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  PROVIDER_URL: 'https://some.self.hosted.mainnet.url',
  SS_CURRENCY_CONVERTER_API_KEY: '18e06827-8544-4b0f-a639-33df3b5bc62f',
};

describe('callApi', () => {
  const config: Config = JSON.parse(readFileSync(join(__dirname, '../../config/airkeeper.example.json')).toString());
  const interpolatedConfig = interpolateSecrets(config, envVariables);
  if (!interpolatedConfig.success) {
    throw new Error('Secrets interpolation failed. Caused by: ' + interpolatedConfig.error.message);
  }
  const { ois, apiCredentials } = config;
  const endpoint = interpolatedConfig.data.endpoints[Object.keys(interpolatedConfig.data.endpoints)[0]];
  const templateId = Object.keys(interpolatedConfig.data.templatesV1)[0];
  const templateParameters = interpolatedConfig.data.templatesV1[templateId].encodedParameters;
  const apiCallParameters = abi.decode(templateParameters);

  it('calls the api and returns the value', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { data: { success: true, result: '723.392028' } };
    spy.mockResolvedValue(apiResponse);

    const [logs, res] = await callApi({ ois, apiCredentials }, endpoint, apiCallParameters);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([{ level: 'DEBUG', message: 'API value: 723392028' }]));
    expect(res).toBeDefined();
    expect(res).toEqual(ethers.BigNumber.from(723392028));
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("returns null if reserved parameter '_type' is missing", async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { data: { success: true, result: '723.392028' } };
    spy.mockResolvedValueOnce(apiResponse);
    const oisesWithoutType = interpolatedConfig.data.ois.map((o) => ({
      ...o,
      endpoints: o.endpoints.map((e) => ({
        ...e,
        reservedParameters: e.reservedParameters.filter((r) => r.name !== '_type'),
      })),
    }));

    const [logs, res] = await callApi(
      { ...interpolatedConfig.data, ois: oisesWithoutType },
      endpoint,
      apiCallParameters
    );

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(
      expect.arrayContaining([{ level: 'ERROR', message: "Cannot read property 'length' of undefined" }])
    );
    expect(res).toEqual(null);
  });

  it('returns an error if the API call fails to extract and encode response', async () => {
    const buildAndExecuteRequestSpy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;
    const apiResponse = { data: { success: true, result: '723.392028' } };
    buildAndExecuteRequestSpy.mockResolvedValueOnce(apiResponse);

    const extractAndEncodeResponseSpy = jest.spyOn(adapter, 'extractAndEncodeResponse');
    const error = new Error('Unexpected error');
    extractAndEncodeResponseSpy.mockImplementationOnce(() => {
      throw error;
    });

    const [logs, res] = await callApi(interpolatedConfig.data, endpoint, apiCallParameters);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([{ level: 'ERROR', message: 'Unexpected error' }]));
    expect(res).toEqual(null);
    expect(buildAndExecuteRequestSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledWith(apiResponse.data, expect.any(Object));
  });
});
