import { readFileSync } from 'fs';
import { join } from 'path';
import * as abi from '@api3/airnode-abi';
import * as adapter from '@api3/airnode-adapter';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { callApi } from './call-api';
import { AirkeeperConfig } from '../validator';
import { mergeConfigs } from '../config';

describe('callApi', () => {
  const airnodeWalletMnemonic = 'achieve climb couple wait accident symbol spy blouse reduce foil echo label';
  const airnodeConfig: node.Config = JSON.parse(
    readFileSync(join(__dirname, '../../config/config.example.json')).toString()
  );
  const airkeeperConfig: AirkeeperConfig = JSON.parse(
    readFileSync(join(__dirname, '../../config/airkeeper.example.json')).toString()
  );
  const config = mergeConfigs(
    { ...airnodeConfig, nodeSettings: { ...airnodeConfig.nodeSettings, airnodeWalletMnemonic: airnodeWalletMnemonic } },
    airkeeperConfig
  );
  const airnodeAddress = airkeeperConfig.airnodeAddress;
  const airnodeXpub = airkeeperConfig.airnodeXpub;
  if (airkeeperConfig.airnodeAddress && airkeeperConfig.airnodeAddress !== airnodeAddress) {
    throw new Error(`xpub does not belong to Airnode: ${airnodeAddress}`);
  }
  const endpoint = airkeeperConfig.endpoints[Object.keys(airkeeperConfig.endpoints)[0]];
  const templateId = Object.keys(airkeeperConfig.templates)[0];
  const templateParameters = airkeeperConfig.templates[templateId].templateParameters;
  const apiCallParameters = abi.decode(templateParameters);

  it('calls the api and returns the value', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { data: { success: true, result: '723.392028' } };
    spy.mockResolvedValue(apiResponse);

    let [logs, res] = await callApi(config, endpoint, apiCallParameters);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([{ level: 'DEBUG', message: 'API value: 723392028' }]));
    expect(res).toBeDefined();
    expect(res).toEqual(ethers.BigNumber.from(723392028));
    expect(spy).toHaveBeenCalledTimes(1);

    [logs, res] = await callApi({ ...config, airnodeXpub }, endpoint, apiCallParameters);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([{ level: 'DEBUG', message: 'API value: 723392028' }]));
    expect(res).toBeDefined();
    expect(res).toEqual(ethers.BigNumber.from(723392028));
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it("returns null if reserved parameter '_type' is missing", async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { data: { success: true, result: '723.392028' } };
    spy.mockResolvedValueOnce(apiResponse);
    const oisesWithoutType = airnodeConfig.ois.map((o) => ({
      ...o,
      endpoints: o.endpoints.map((e) => ({
        ...e,
        reservedParameters: e.reservedParameters.filter((r) => r.name !== '_type'),
      })),
    }));

    const [logs, res] = await callApi({ ...config, ois: oisesWithoutType }, endpoint, apiCallParameters);

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

    const [logs, res] = await callApi(config, endpoint, apiCallParameters);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(expect.arrayContaining([{ level: 'ERROR', message: 'Unexpected error' }]));
    expect(res).toEqual(null);
    expect(buildAndExecuteRequestSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledWith(apiResponse.data, expect.any(Object));
  });
});
