import { Config } from '../../src';

export const buildConfig = (): Config => ({
  chains: [
    {
      contracts: {
        AirnodeRrp: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
        RrpBeaconServer: '0x610178dA211FEF7D417bC0e6FeD39F05609AD788',
        DapiServer: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      },
      id: '31337',
      providers: {
        local: {
          url: 'http://127.0.0.1:8545',
        },
      },
      type: 'evm',
      options: {
        fulfillmentGasLimit: 500000,
        gasPriceOracle: [
          {
            gasPriceStrategy: 'constantGasPrice',
            gasPrice: {
              value: 10,
              unit: 'gwei',
            },
          },
        ],
      },
    },
  ],
  nodeSettings: {
    airnodeWalletMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
    airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    airnodeXpub:
      'xpub6CjvSJ3sybHuVaYnQsCvNQnXfNrMusXEtfoAvYuS1pEDtKngXQE1dcTDXR9dgwfqdakksFrhNHeKiqsYKD6KS5mga1NvegzbV6nKwsNyfGd',
    logFormat: 'plain',
    logLevel: 'INFO',
  },
  triggers: {
    rrpBeaconServerKeeperJobs: [
      {
        chainIds: ['31337'],
        templateId: '0xf3625329761d21bc2c989b6715b2754ebcbe2cac5685a8753790de8ba8d76e08',
        templateParameters: [
          { type: 'string32', name: 'to', value: 'USD' },
          { type: 'string32', name: '_type', value: 'int256' },
          { type: 'string32', name: '_path', value: 'result' },
          { type: 'string32', name: '_times', value: '1000000' },
          { type: 'string32', name: 'from', value: 'ETH' },
        ],
        endpointId: '0x13dea3311fe0d6b84f4daeab831befbc49e19e6494c41e9e065a09c3c68f43b6',
        deviationPercentage: '5',
        keeperSponsor: '0x2479808b1216E998309A727df8A0A98A1130A162',
        requestSponsor: '0x61648B2Ec3e6b3492E90184Ef281C2ba28a675ec',
      },
    ],
    protoPsp: [
      '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e',
      '0xb4c3cea3b78c384eb4409df1497bb2f1fd872f1928a218f8907c38fe0d66ffea',
    ],
  },
  subscriptions: {
    '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e': {
      chainId: '31337',
      airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
      templateId: '0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa',
      parameters: '0x',
      conditions:
        '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e4964000000000000000000000000dc96acc8000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000989680',
      relayer: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
      sponsor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      requester: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      fulfillFunctionId: '0x206b48f4',
    },
    '0xb4c3cea3b78c384eb4409df1497bb2f1fd872f1928a218f8907c38fe0d66ffea': {
      chainId: '31337',
      airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
      templateId: '0x0bbf5f2ec4b0e9faf5b89b4ddbed9bdad7a542cc258ffd7b106b523aeae039a6',
      parameters: '0x',
      conditions:
        '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e4964000000000000000000000000dc96acc8000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000989680',
      relayer: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
      sponsor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
      requester: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
      fulfillFunctionId: '0x206b48f4',
    },
  },
  templatesV1: {
    '0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa': {
      endpointId: '0x13dea3311fe0d6b84f4daeab831befbc49e19e6494c41e9e065a09c3c68f43b6',
      encodedParameters:
        '0x3173737373730000000000000000000000000000000000000000000000000000746f00000000000000000000000000000000000000000000000000000000000055534400000000000000000000000000000000000000000000000000000000005f74797065000000000000000000000000000000000000000000000000000000696e7432353600000000000000000000000000000000000000000000000000005f70617468000000000000000000000000000000000000000000000000000000726573756c7400000000000000000000000000000000000000000000000000005f74696d65730000000000000000000000000000000000000000000000000000313030303030300000000000000000000000000000000000000000000000000066726f6d000000000000000000000000000000000000000000000000000000004554480000000000000000000000000000000000000000000000000000000000',
    },
    '0x0bbf5f2ec4b0e9faf5b89b4ddbed9bdad7a542cc258ffd7b106b523aeae039a6': {
      endpointId: '0x13dea3311fe0d6b84f4daeab831befbc49e19e6494c41e9e065a09c3c68f43b6',
      encodedParameters:
        '0x3173737373730000000000000000000000000000000000000000000000000000746f00000000000000000000000000000000000000000000000000000000000055534400000000000000000000000000000000000000000000000000000000005f74797065000000000000000000000000000000000000000000000000000000696e7432353600000000000000000000000000000000000000000000000000005f70617468000000000000000000000000000000000000000000000000000000726573756c7400000000000000000000000000000000000000000000000000005f74696d65730000000000000000000000000000000000000000000000000000313030303030300000000000000000000000000000000000000000000000000066726f6d000000000000000000000000000000000000000000000000000000004254430000000000000000000000000000000000000000000000000000000000',
    },
  },
  endpoints: {
    '0x13dea3311fe0d6b84f4daeab831befbc49e19e6494c41e9e065a09c3c68f43b6': {
      oisTitle: 'Currency Converter API',
      endpointName: 'convertToUSD',
    },
  },
  ois: [
    {
      oisFormat: '1.1.1',
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
  ],
  apiCredentials: [
    {
      oisTitle: 'Currency Converter API',
      securitySchemeName: 'Currency Converter Security Scheme',
      securitySchemeValue: '${SS_CURRENCY_CONVERTER_API_KEY}',
    },
  ],
});

// Config for ETH subscription
export const buildLocalConfigETH = () => ({
  airnodeMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  privateKeys: {
    deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    manager: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    sponsor: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    randomPerson: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  },
  endpoint: {
    oisTitle: 'Currency Converter API',
    endpointName: 'convertToUSD',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'ETH' },
  ],
  threshold: 10,
});

// Config for BTC subscription
export const buildLocalConfigBTC = () => ({
  airnodeMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  privateKeys: {
    deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
    manager: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
    sponsor: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
    randomPerson: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
  },
  endpoint: {
    oisTitle: 'Currency Converter API',
    endpointName: 'convertToUSD',
  },
  templateParameters: [
    { type: 'string32', name: 'to', value: 'USD' },
    { type: 'string32', name: '_type', value: 'int256' },
    { type: 'string32', name: '_path', value: 'result' },
    { type: 'string32', name: '_times', value: '1000000' },
    { type: 'string32', name: 'from', value: 'BTC' },
  ],
  threshold: 10,
});
