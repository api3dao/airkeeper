import { join } from 'path';
import { ethers } from 'ethers';
import { encode } from '@api3/airnode-abi';
import { AirnodeRrpAddresses } from '@api3/airnode-protocol';
import { readOperationsRepository } from '@api3/operations/dist/utils/read-operations';
import { ChainOptions } from '@api3/airnode-node';
import { deriveEndpointId } from '@api3/airnode-admin';
import prompts, { PromptObject } from 'prompts';
import { runAndHandleErrors, writeJsonFile, getDapiServerInterface, sanitiseFilename } from './utils';
import { Config, ChainConfig, NodeSettings, Subscriptions, Triggers, Templates, Endpoints } from '../../src';

const questions = (): PromptObject[] => {
  return [
    {
      type: 'multiselect',
      name: 'configurationType',
      message: 'Which configurations do you want to generate?',
      choices: [
        { title: 'Proto-PSP', value: 'psp', selected: true },
        { title: 'RRP Beacon Server', value: 'rrp', disabled: true },
      ],
    },
    {
      type: 'select',
      name: 'dataType',
      message: 'Do you want to use Operations repository or use local data?',
      choices: [
        { title: 'Operations Repository', value: 'operations', selected: true },
        { title: 'Local', value: 'local' },
      ],
    },
    {
      type: (prev, values) => (values.dataType.includes('local') ? 'confirm' : null),
      name: 'localConfirm',
      message:
        'To use the scripts locally make sure your data is structured similar to the operations repository and is placed in "/scripts/config/data"',
      initial: true,
    },
    {
      type: 'autocomplete',
      name: 'apiName',
      message: 'What is the name of the API Integration?',
      choices: (prev, values) =>
        Object.keys(
          readOperationsRepository(values.dataType.includes('local') ? join(__dirname, 'data') : undefined).apis
        ).map((api) => ({ title: api, value: api })),
    },
  ];
};

const main = async () => {
  const operationsRepository = readOperationsRepository();
  const response = await prompts(questions(), {
    onCancel: () => {
      throw new Error('Aborted by the user');
    },
  });
  const apiData = operationsRepository.apis[response.apiName];

  const { airnode, xpub } = apiData.apiMetadata;

  const apiChains = [...new Set(Object.values(apiData.beacons).flatMap((beacon: any) => Object.keys(beacon.chains)))];

  const chains: ChainConfig[] = apiChains.map((chainName): ChainConfig => {
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
          gasPriceStrategy: 'latestBlockPercentileGasPrice',
          percentile: 60,
          minTransactionCount: 20,
          pastToCompareInBlocks: 20,
          maxDeviationMultiplier: 2,
        },
        {
          gasPriceStrategy: 'providerRecommendedGasPrice',
          recommendedGasPriceMultiplier: 1.2,
        },
        {
          gasPriceStrategy: 'constantGasPrice',
          gasPrice: {
            value: 10,
            unit: 'gwei',
          },
        },
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
      type: 'evm',
      options,
    };
  });

  const nodeSettings: NodeSettings = {
    airnodeWalletMnemonic: '${AIRNODE_WALLET_MNEMONIC}',
    airnodeAddress: airnode,
    airnodeXpub: xpub,
    logFormat: 'plain',
    logLevel: 'INFO',
  };

  const apiCredentials = Object.values(apiData.ois).flatMap((ois: any) =>
    Object.keys(ois.apiSpecifications.components.securitySchemes).map((security) => ({
      oisTitle: ois.title,
      securitySchemeName: security,
      securitySchemeValue: `\${SS_${sanitiseFilename(security).toUpperCase()}}`.replace(/ /g, '_').replace(/\-/g, '_'),
    }))
  );

  const oisSecrets = Object.values(apiData.ois).flatMap((ois: any) =>
    Object.keys(ois.apiSpecifications.components.securitySchemes).map((security) =>
      `SS_${sanitiseFilename(security).toUpperCase()}=`.replace(/ /g, '_').replace(/\-/g, '_')
    )
  );

  const airkeeperSecretsArray = [
    'AIRNODE_WALLET_MNEMONIC=""',
    ...apiChains.map((chainName) => `${sanitiseFilename(chainName).replace(/\-/g, '_')}_PROVIDER_URL=`.toUpperCase()),
    ...oisSecrets,
  ];

  const awsSecretsArray = [`AWS_ACCESS_KEY_ID=`, `AWS_SECRET_ACCESS_KEY=`, `AWS_SESSION_TOKEN=`];

  const airkeeperSubscriptions: Subscriptions = Object.values(apiData.beacons)
    .flatMap((beacon) =>
      Object.entries(beacon.chains)
        .filter(([, chain]) => 'updateConditionPercentage' in chain)
        .map(([chainName, chain]) => {
          const chainId = parseInt(operationsRepository.chains[chainName].id);
          const dapiServerInteface = getDapiServerInterface();
          const parameters = '0x';
          const airnodeAddress = beacon.airnodeAddress;
          const templateId = beacon.templateId;

          const threshold = ethers.BigNumber.from(100000000)
            .mul(chain.updateConditionPercentage! * 100)
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
    // TODO: Add rrpBeaconServer Triggers
    rrpBeaconServerKeeperJobs: [],
    protoPsp: Object.keys(airkeeperSubscriptions),
  };

  const airkeeperTemplates: Templates = Object.values(apiData.templates).reduce(
    (templateObj, template) => ({
      ...templateObj,
      [template.templateId]: {
        endpointId: template.endpointId,
        encodedParameters: template.parameters,
      },
    }),
    {}
  );

  const airkeeperEndpointArray = await Promise.all(
    Object.values(apiData.ois).flatMap((ois) => {
      return ois.endpoints.map(async (endpoint) => ({
        [await deriveEndpointId(ois.title, endpoint.name)]: { endpointName: endpoint.name, oisTitle: ois.title },
      }));
    })
  );

  const AirkeeperEndpoints: Endpoints = airkeeperEndpointArray.reduce(
    (endpointsObject, endpoint) => ({ ...endpointsObject, ...endpoint }),
    {}
  );

  const airkeeper: Config = {
    chains: chains,
    nodeSettings: nodeSettings,
    triggers: airkeeperTriggers,
    subscriptions: airkeeperSubscriptions,
    templatesV1: airkeeperTemplates,
    endpoints: AirkeeperEndpoints,
    ois: Object.values(apiData.ois),
    apiCredentials: apiCredentials,
  };

  writeJsonFile(join(__dirname, '..', '..', 'config', 'airkeeper.json'), airkeeper);
  writeJsonFile(join(__dirname, '..', '..', 'config', 'secrets'), {
    filename: '.env',
    content: airkeeperSecretsArray.join('\n'),
  });
  writeJsonFile(join(__dirname, '..', '..', 'config', 'aws'), {
    filename: '.env',
    content: awsSecretsArray.join('\n'),
  });
};

if (require.main === module) runAndHandleErrors(main);

export { main as createConfig };
