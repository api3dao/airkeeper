import { join } from 'path';
import { ethers } from 'ethers';
import { encode } from '@api3/airnode-abi';
import { AirnodeRrpAddresses } from '@api3/airnode-protocol';
import { readOperationsRepository } from '@api3/operations/dist/utils/read-operations';
import { ChainOptions } from '@api3/airnode-node';
import {
  readConfigurationData,
  runAndHandleErrors,
  writeJsonFile,
  getDapiServerInterface,
  sanitiseFilename,
} from './utils';
import { Config, ChainConfig, NodeSettings, Subscriptions, Triggers, Templates, Endpoints } from '../../src';

const main = async () => {
  const operationsRepository = readOperationsRepository();
  const ConfigurationData = readConfigurationData();

  const { airnode, xpub } = Object.values(ConfigurationData.beacons)[0] as any;

  const apiChains = [
    ...new Set(Object.values(ConfigurationData.beacons).flatMap((beacon: any) => Object.keys(beacon.chains))),
  ];

  const chains: ChainConfig[] = apiChains.map((chainName) => {
    const chainId = parseInt(operationsRepository.chains[chainName].id);
    const contracts = {
      AirnodeRrp: AirnodeRrpAddresses[chainId] || '',
      RrpBeaconServer: operationsRepository.chains[chainName].contracts.RrpBeaconServer || '',
      DapiServer: operationsRepository.chains[chainName].contracts.DapiServer || '',
    };
    const options: ChainOptions = {
      fulfillmentGasLimit: 500000,
      gasPriceOracle: [
        {
          gasPriceStrategy: 'constantGasPrice',
          gasPrice: {
            value: 10,
            unit: 'gwei',
          },
        } as const,
      ],
    };
    const providers = {
      [`provider_${sanitiseFilename(chainName).replace(/\-/g, '_')}`]: {
        url: `\${${sanitiseFilename(chainName).replace(/\-/g, '_')}_PROVIDER_URL}`.toUpperCase(),
      },
    };

    return {
      contracts,
      id: `${chainId}`,
      providers,
      type: 'evm' as const,
      options,
    };
  });

  const nodeSettings = {
    airnodeWalletMnemonic: '${AIRNODE_WALLET_MNEMONIC}',
    airnodeAddress: airnode,
    airnodeXpub: xpub,
    logFormat: 'plain',
    logLevel: 'INFO',
  } as NodeSettings;

  const apiCredentials = Object.values(ConfigurationData.ois).flatMap((ois: any) =>
    Object.keys(ois.apiSpecifications.components.securitySchemes).map((security) => ({
      oisTitle: ois.title,
      securitySchemeName: security,
      securitySchemeValue: `\${SS_${sanitiseFilename(security).toUpperCase()}}`.replace(/ /g, '_').replace(/\-/g, '_'),
    }))
  );

  const oisSecrets = Object.values(ConfigurationData.ois).flatMap((ois: any) =>
    Object.keys(ois.apiSpecifications.components.securitySchemes).map((security) =>
      `SS_${sanitiseFilename(security).toUpperCase()}=`.replace(/ /g, '_').replace(/\-/g, '_')
    )
  );

  const airkeeperSecretsArray = [
    'AIRNODE_WALLET_MNEMONIC=""',
    ...apiChains.map((chainName) => `${sanitiseFilename(chainName).replace(/\-/g, '_')}_PROVIDER_URL=`.toUpperCase()),
    ...oisSecrets,
  ];

  const awsSecretsArray = [
    `AWS_ACCESS_KEY_ID=`,
    `AWS_SECRET_ACCESS_KEY=`,
    `AWS_SESSION_TOKEN=`,
    `REGION=us-east-1`,
    `STAGE=dev`,
  ];

  const airkeeperSubscriptions: Subscriptions = Object.values(ConfigurationData.beacons)
    .flatMap((beacon: any) =>
      Object.entries(beacon.chains).map(([chainName, chain]: any) => {
        const chainId = parseInt(operationsRepository.chains[chainName].id);
        const dapiServerInteface = getDapiServerInterface();
        const parameters = '0x';
        const airnodeAddress = airnode;
        const templateParameters = encode(beacon.template.decodedParameters);
        const endpointId = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['string', 'string'],
            [beacon.template.oisTitle, beacon.template.endpointName]
          )
        );
        const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, templateParameters]);
        const threshold = ethers.BigNumber.from(100000000)
          .mul(chain.updateConditionPercentage * 100)
          .div(10000);
        const beaconUpdateSubscriptionConditionParameters = ethers.utils.defaultAbiCoder.encode(
          ['uint256'],
          [threshold]
        );
        const encodedBeaconUpdateSubscriptionConditions = encode([
          {
            type: 'bytes32',
            name: '_conditionFunctionId',
            value: ethers.utils.defaultAbiCoder.encode(
              ['bytes4'],
              [dapiServerInteface.getSighash('conditionPspBeaconUpdate')]
            ),
          },
          { type: 'bytes', name: '_conditionParameters', value: beaconUpdateSubscriptionConditionParameters },
        ]);
        const dapiServerAddress = operationsRepository.chains[chainName].contracts.DapiServer;
        const sponsor = chain.sponsor;
        const beaconUpdateSubscriptionId = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(
            ['uint256', 'address', 'bytes32', 'bytes', 'bytes', 'address', 'address', 'address', 'bytes4'],
            [
              chainId,
              airnodeAddress,
              templateId,
              parameters,
              encodedBeaconUpdateSubscriptionConditions,
              airnodeAddress,
              sponsor,
              dapiServerAddress,
              dapiServerInteface.getSighash('fulfillPspBeaconUpdate'),
            ]
          )
        );
        return {
          [beaconUpdateSubscriptionId]: {
            chainId: `${chainId}`,
            parameters,
            airnodeAddress,
            templateId,
            conditions: encodedBeaconUpdateSubscriptionConditions,
            relayer: airnodeAddress,
            sponsor,
            requester: dapiServerAddress,
            fulfillFunctionId: dapiServerInteface.getSighash('fulfillPspBeaconUpdate'),
          },
        };
      })
    )
    .reduce((subscriptionsObject, subscription) => ({ ...subscriptionsObject, ...subscription }), {});

  const airkeeperTriggers: Triggers = {
    rrpBeaconServerKeeperJobs: [],
    protoPsp: Object.keys(airkeeperSubscriptions),
  };

  const airkeeperTemplates = Object.values(ConfigurationData.beacons)
    .map((beacon: any) => beacon.template)
    .reduce((templateObj: any, template: any) => {
      const endpointId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['string', 'string'], [template.oisTitle, template.endpointName])
      );
      const encodedParameters = encode(template.decodedParameters);
      const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, encodedParameters]);

      return {
        ...templateObj,
        [templateId]: {
          endpointId,
          encodedParameters,
        },
      };
    }, {}) as Templates;

  const airkeeperEndpointArray = Object.values(ConfigurationData.ois).flatMap((ois: any) => {
    return ois.endpoints.map((endpoint: any) => ({
      [ethers.utils.keccak256(ethers.utils.defaultAbiCoder.encode(['string', 'string'], [ois.title, endpoint.name]))]: {
        endpointName: endpoint.name,
        oisTitle: ois.title,
      },
    }));
  });

  const AirkeeperEndpoints = airkeeperEndpointArray.reduce(
    (endpointsObject, endpoint) => ({ ...endpointsObject, ...endpoint }),
    {}
  ) as Endpoints;

  const airkeeper: Config = {
    chains: chains,
    nodeSettings: nodeSettings,
    triggers: airkeeperTriggers,
    subscriptions: airkeeperSubscriptions,
    templatesV1: airkeeperTemplates,
    endpoints: AirkeeperEndpoints,
    ois: Object.values(ConfigurationData.ois),
    apiCredentials: apiCredentials,
  };

  writeJsonFile(join(__dirname, 'airkeeper.json'), airkeeper);
  writeJsonFile(join(__dirname, 'secrets'), { filename: '.env', content: airkeeperSecretsArray.join('\n') });
  writeJsonFile(join(__dirname, 'aws'), { filename: '.env', content: awsSecretsArray.join('\n') });

  console.log(airkeeper);
};

if (require.main === module) runAndHandleErrors(main);

export { main as createConfig };
