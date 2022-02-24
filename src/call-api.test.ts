import * as abi from '@api3/airnode-abi';
import * as adapter from '@api3/airnode-adapter';
import * as node from '@api3/airnode-node';
import * as ois from '@api3/airnode-ois';
import { ethers } from 'ethers';
import { callApi } from './call-api';

describe('callApi', () => {
  const oises: ois.OIS[] = [
    {
      oisFormat: '1.0.0',
      version: '1.2.3',
      title: 'Currency Converter API',
      apiSpecifications: {
        servers: [
          {
            url: 'http://localhost:5000',
          },
        ],
        paths: {
          '/convert': {
            get: {
              parameters: [
                {
                  in: 'query',
                  name: 'from',
                },
                {
                  in: 'query',
                  name: 'to',
                },
                {
                  in: 'query',
                  name: 'amount',
                },
                {
                  in: 'query',
                  name: 'date',
                },
              ],
            },
          },
        },
        components: {
          securitySchemes: {
            'Currency Converter Security Scheme': {
              in: 'query',
              type: 'apiKey',
              name: 'access_key',
            },
          },
        },
        security: {
          'Currency Converter Security Scheme': [],
        },
      },
      endpoints: [
        {
          name: 'convertToUSD',
          operation: {
            method: 'get',
            path: '/convert',
          },
          fixedOperationParameters: [
            {
              operationParameter: {
                in: 'query',
                name: 'to',
              },
              value: 'USD',
            },
          ],
          reservedParameters: [
            {
              name: '_type',
              fixed: 'int256',
            },
            {
              name: '_path',
              fixed: 'result',
            },
            {
              name: '_times',
              default: '1000000',
            },
          ],
          parameters: [
            {
              name: 'from',
              default: 'EUR',
              operationParameter: {
                in: 'query',
                name: 'from',
              },
            },
            {
              name: 'amount',
              default: '1',
              operationParameter: {
                name: 'amount',
                in: 'query',
              },
            },
          ],
        },
      ],
    },
  ];
  const apiCredentials: node.ApiCredentials[] = [
    {
      oisTitle: 'Currency Converter API',
      securitySchemeName: 'Currency Converter Security Scheme',
      securitySchemeValue: '${SS_CURRENCY_CONVERTER_API_KEY}',
    },
  ];

  const templateId = '0x6f737bbf31dfed584a16f53b7d725ff64bee67e79a468259456fb40aa19c60c4';
  const templateParameters = [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '100000' },
    { type: 'string32', name: 'from', value: 'ETH' },
  ];
  const oisTitle = 'Currency Converter API';
  const endpointName = 'convertToUSD';

  const encodedParameters = abi.encode(templateParameters);
  const beaconId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [templateId, encodedParameters]);

  const callApiOptions = {
    oises,
    apiCredentials,
    id: beaconId,
    templateParameters,
    oisTitle,
    endpointName,
  };

  it('calls the adapter with the given parameters', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const apiResponse = { success: true, result: '723.392028' };
    spy.mockResolvedValueOnce({
      data: apiResponse,
    });

    const [logs, res] = await callApi(callApiOptions);

    expect(logs).toHaveLength(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          level: 'DEBUG',
          message: `API server response data: ${JSON.stringify(apiResponse)}`,
        },
        {
          level: 'INFO',
          message: 'API value: 72339202',
        },
      ])
    );
    expect(res).toBeDefined();
    expect(res).toEqual({
      '0xda81ccdbd098065ac2f16228ff382885f8f5d52de4d765e2e1e5b2036add70b6': ethers.BigNumber.from(72339202),
    });
    expect(spy).toHaveBeenCalledTimes(1);
    const { securitySchemeName, securitySchemeValue } = apiCredentials[0];
    expect(spy).toHaveBeenCalledWith({
      ois: oises[0],
      endpointName: 'convertToUSD',
      parameters: {
        to: 'USD',
        from: 'ETH',
      },
      apiCredentials: [
        {
          securitySchemeName,
          securitySchemeValue,
        },
      ],
      metadata: null,
    });
  });

  it("returns null if reserved parameter '_type' is missing", async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;

    const oisesWithoutType = oises.map((o) => ({
      ...o,
      endpoints: o.endpoints.map((e) => ({
        ...e,
        reservedParameters: e.reservedParameters.filter((r) => r.name !== '_type'),
      })),
    }));

    const [logs, res] = await callApi({
      ...callApiOptions,
      oises: oisesWithoutType,
    });

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          level: 'ERROR',
          message: expect.stringMatching("reserved parameter '_type' is missing for endpoint: convertToUSD"),
        },
      ])
    );
    expect(Object.values(res)).toEqual([null]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns an error if the API call fails to execute', async () => {
    const spy = jest.spyOn(adapter, 'buildAndExecuteRequest') as any;
    const error = new Error('Network is down');
    spy.mockRejectedValueOnce(error);

    const [logs, res] = await callApi(callApiOptions);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          error,
          level: 'ERROR',
          message: expect.stringMatching('failed to fetch data from API for endpoint: convertToUSD'),
        },
      ])
    );
    expect(Object.values(res)).toEqual([null]);
    expect(spy).toHaveBeenCalledTimes(1);
    const { securitySchemeName, securitySchemeValue } = apiCredentials[0];
    expect(spy).toHaveBeenCalledWith({
      ois: oises[0],
      endpointName: 'convertToUSD',
      parameters: {
        to: 'USD',
        from: 'ETH',
      },
      apiCredentials: [
        {
          securitySchemeName,
          securitySchemeValue,
        },
      ],
      metadata: null,
    });
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

    const [logs, res] = await callApi(callApiOptions);

    expect(logs).toHaveLength(1);
    expect(logs).toEqual(
      expect.arrayContaining([
        {
          error,
          level: 'ERROR',
          message: `failed to extract or encode value from API response: ${JSON.stringify(apiResponse)}`,
        },
      ])
    );
    expect(Object.values(res)).toEqual([null]);
    expect(buildAndExecuteRequestSpy).toHaveBeenCalledTimes(1);
    const { securitySchemeName, securitySchemeValue } = apiCredentials[0];
    expect(buildAndExecuteRequestSpy).toHaveBeenCalledWith({
      ois: oises[0],
      endpointName: 'convertToUSD',
      parameters: {
        to: 'USD',
        from: 'ETH',
      },
      apiCredentials: [
        {
          securitySchemeName,
          securitySchemeValue,
        },
      ],
      metadata: null,
    });
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledTimes(1);
    expect(extractAndEncodeResponseSpy).toHaveBeenCalledWith(apiResponse, expect.any(Object));
  });
});
