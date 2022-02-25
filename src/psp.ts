import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import merge from 'lodash/merge';
import { callApi } from './call-api';
import { GAS_LIMIT } from './constants';
import { ChainConfig, Config, Subscription } from './types';
import { deriveSponsorWallet, loadNodeConfig, parseConfig, retryGo } from './utils';

//TODO: where to get abi from?
const dapiServerAbi = [
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'subscriptionId',
        type: 'bytes32',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'bytes',
        name: 'conditionParameters',
        type: 'bytes',
      },
    ],
    name: 'conditionPspBeaconUpdate',
    outputs: [
      {
        internalType: 'bool',
        name: '',
        type: 'bool',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        internalType: 'bytes32',
        name: 'subscriptionId',
        type: 'bytes32',
      },
      {
        internalType: 'address',
        name: 'airnode',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'relayer',
        type: 'address',
      },
      {
        internalType: 'address',
        name: 'sponsor',
        type: 'address',
      },
      {
        internalType: 'uint256',
        name: 'timestamp',
        type: 'uint256',
      },
      {
        internalType: 'bytes',
        name: 'data',
        type: 'bytes',
      },
      {
        internalType: 'bytes',
        name: 'signature',
        type: 'bytes',
      },
    ],
    name: 'fulfillPspBeaconUpdate',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
];

export const beaconUpdate = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  const airnodeConfig = loadNodeConfig();
  // This file will be merged with config.json from above
  const airkeeperConfig: Config = parseConfig('airkeeper');

  const baseLogOptions = node.logger.buildBaseOptions(airnodeConfig, {
    coordinatorId: node.utils.randomHexString(8),
  });
  node.logger.info(`PSP beacon update started at ${node.utils.formatDateTime(startedAt)}`, baseLogOptions);

  const config = {
    ...airnodeConfig,
    chains: airkeeperConfig.chains.map((chain) => {
      if (isNil(chain.id)) {
        throw new Error(`Missing 'id' property in chain config: ${JSON.stringify(chain)}`);
      }
      const configChain = airnodeConfig.chains.find((c) => c.id === chain.id);
      if (isNil(configChain)) {
        throw new Error(`Chain id ${chain.id} not found in node config.json`);
      }
      return merge(configChain, chain);
    }),
    triggers: { ...airnodeConfig.triggers, ...airkeeperConfig.triggers },
    subscriptions: airkeeperConfig.subscriptions,
    templates: airkeeperConfig.templates,
    endpoints: airkeeperConfig.endpoints,
  };
  const { chains, nodeSettings, triggers, ois: oises, apiCredentials, subscriptions, templates, endpoints } = config;

  const airnodeWallet = ethers.Wallet.fromMnemonic(nodeSettings.airnodeWalletMnemonic);
  const { address: airnodeAddress } = airnodeWallet;

  // **************************************************************************
  // 2. Process chain providers in parallel
  // **************************************************************************
  node.logger.debug('Processing chain providers...', baseLogOptions);

  const evmChains = chains.filter((chain: ChainConfig) => chain.type === 'evm');
  if (isEmpty(chains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: ChainConfig) =>
      map(chain.providers, async (chainProvider, providerName) => {
        const providerLogOptions = {
          ...baseLogOptions,
          meta: {
            ...baseLogOptions.meta,
            providerName,
            chainId: chain.id,
          },
        };

        // **************************************************************************
        // Initialize provider specific data
        // **************************************************************************
        node.logger.debug('Initializing provider...', providerLogOptions);

        const chainProviderUrl = chainProvider.url || '';
        const provider = node.evm.buildEVMProvider(chainProviderUrl, chain.id);
        const dapiServer = new ethers.Contract(chain.contracts.DapiServer, dapiServerAbi, provider);
        const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

        // **************************************************************************
        // Fetch current block number
        // **************************************************************************
        const [errorGetBlockNumber, currentBlock] = await retryGo(() => provider.getBlockNumber());
        if (errorGetBlockNumber || isNil(currentBlock)) {
          node.logger.error('Failed to fetch the blockNumber', {
            ...providerLogOptions,
            error: errorGetBlockNumber,
          });
          return;
        }

        // **************************************************************************
        // Fetch current gas fee data
        // **************************************************************************
        node.logger.debug('Fetching gas price...', providerLogOptions);

        const [gasPriceLogs, gasTarget] = await node.evm.getGasPrice({
          provider,
          chainOptions: chain.options,
        });
        if (!isEmpty(gasPriceLogs)) {
          node.logger.logPending(gasPriceLogs, providerLogOptions);
        }
        if (!gasTarget) {
          node.logger.error('Failed to fetch gas price', providerLogOptions);
          return;
        }

        // **************************************************************************
        // Fetch subscriptions details
        // **************************************************************************
        node.logger.debug('Fetching subscriptions details...', providerLogOptions);

        const enabledSubscriptions: (Subscription & { subscriptionId: string })[] = [];
        triggers['proto-psp'].forEach((subscriptionId) => {
          const subscription = subscriptions[subscriptionId];
          if (isNil(subscription)) {
            node.logger.warn(`SubscriptionId ${subscriptionId} not found in subscriptions`, providerLogOptions);
            return;
          }

          // **************************************************************************
          // Verify subscriptionId
          // **************************************************************************
          node.logger.debug('Verifying subscriptionId...', providerLogOptions);

          const expectedSubscriptionId = ethers.utils.solidityKeccak256(
            ['uint256', 'address', 'bytes32', 'bytes', 'bytes', 'address', 'address', 'address', 'bytes4'],
            [
              subscription.chainId,
              subscription.airnodeAddress,
              subscription.templateId,
              subscription.parameters,
              subscription.conditions,
              subscription.relayer,
              subscription.sponsor,
              subscription.requester,
              subscription.fulfillFunctionId,
            ]
          );
          if (subscriptionId !== expectedSubscriptionId) {
            node.logger.warn(
              `SubscriptionId ${subscriptionId} does not match expected ${expectedSubscriptionId}`,
              providerLogOptions
            );
            return;
          }

          // TODO: should we also check that airnodeWallet.address === subscription.airnodeAddress? 🤔

          enabledSubscriptions.push({
            ...subscription,
            subscriptionId,
          });
        });
        if (isEmpty(enabledSubscriptions)) {
          node.logger.info('No proto-psp subscriptions to process', providerLogOptions);
          return;
        }

        // **************************************************************************
        // Process each sponsor address in parallel
        // **************************************************************************
        node.logger.debug('Processing sponsor addresses...', providerLogOptions);

        const subscriptionsBySponsor = groupBy(enabledSubscriptions, 'sponsor');
        const sponsorAddresses = Object.keys(subscriptionsBySponsor);

        const sponsorWalletPromises = sponsorAddresses.map(async (sponsor) => {
          // **************************************************************************
          // Derive sponsorWallet address
          // **************************************************************************
          node.logger.debug('Deriving sponsorWallet...', providerLogOptions);

          // TODO: switch to node.evm.deriveSponsorWallet when @api3/airnode-node allows setting the `protocolId`
          const sponsorWallet = deriveSponsorWallet(
            nodeSettings.airnodeWalletMnemonic,
            sponsor,
            '2' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
          ).connect(provider);

          const sponsorWalletLogOptions = {
            ...providerLogOptions,
            additional: {
              sponsorWallet: sponsorWallet.address.replace(sponsorWallet.address.substring(5, 38), '...'),
            },
          };

          // **************************************************************************
          // Fetch sponsorWallet transaction count
          // **************************************************************************
          node.logger.debug('Fetching transaction count...', sponsorWalletLogOptions);

          const [errorGetTransactionCount, sponsorWalletTransactionCount] = await retryGo(() =>
            provider.getTransactionCount(sponsorWallet.address, currentBlock)
          );
          if (errorGetTransactionCount || isNil(sponsorWalletTransactionCount)) {
            node.logger.error('Failed to fetch the sponsor wallet transaction count', {
              ...sponsorWalletLogOptions,
              error: errorGetTransactionCount,
            });
            return;
          }
          let nextNonce = sponsorWalletTransactionCount;

          // **************************************************************************
          // Process each psp subscription in serial to keep nonces in order
          // **************************************************************************
          node.logger.debug('Processing subscriptions...', sponsorWalletLogOptions);

          const sponsorSubscriptions = subscriptionsBySponsor[sponsor];
          for (const { subscriptionId, templateId, conditions, relayer, fulfillFunctionId } of sponsorSubscriptions ||
            []) {
            const subscriptionIdLogOptions = {
              ...sponsorWalletLogOptions,
              additional: {
                ...sponsorWalletLogOptions.additional,
                subscriptionId,
              },
            };

            // **************************************************************************
            // Fetch template details
            // **************************************************************************
            node.logger.debug('Fetching template details...', subscriptionIdLogOptions);

            const template = templates[templateId];
            if (isNil(template)) {
              node.logger.warn(`TemplateId ${templateId} not found in templates`, subscriptionIdLogOptions);
              continue;
            }

            // **************************************************************************
            // Verify templateId
            // **************************************************************************
            const expectedTemplateId = ethers.utils.solidityKeccak256(
              ['bytes32', 'bytes'],
              [template.endpointId, template.templateParameters]
            );
            if (expectedTemplateId !== templateId) {
              node.logger.warn(
                `TemplateId ${templateId} does not match expected ${expectedTemplateId}`,
                subscriptionIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // Fetch endpoint details
            // **************************************************************************
            node.logger.debug('Fetching template details...', subscriptionIdLogOptions);

            const endpoint = endpoints[template.endpointId];
            if (isNil(endpoint)) {
              node.logger.warn(`EndpointId ${template.endpointId} not found in endpoints`, subscriptionIdLogOptions);
              continue;
            }

            // **************************************************************************
            // Verify endpointId
            // **************************************************************************
            const expectedEndpointId = ethers.utils.keccak256(
              ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
            );
            if (expectedEndpointId !== template.endpointId) {
              node.logger.warn(
                `EndpointId ${template.endpointId} does not match expected ${expectedEndpointId}`,
                subscriptionIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // Make API call
            // **************************************************************************
            node.logger.debug('Making API request...', subscriptionIdLogOptions);

            const apiCallParameters = abi.decode(template.templateParameters);
            const [errorCallApi, logsData] = await retryGo(() =>
              callApi({
                oises,
                apiCredentials,
                apiCallParameters,
                oisTitle: endpoint.oisTitle,
                endpointName: endpoint.endpointName,
              })
            );
            if (!isNil(errorCallApi) || isNil(logsData)) {
              node.logger.warn('Failed to fecth API value', subscriptionIdLogOptions);
              continue;
            }
            const [logs, apiValue] = logsData;
            node.logger.logPending(logs, subscriptionIdLogOptions);

            if (isNil(apiValue)) {
              node.logger.warn('API value not found. Skipping update...', subscriptionIdLogOptions);
              continue;
            }

            // **************************************************************************
            // Check conditions
            // **************************************************************************
            node.logger.debug('Checking conditions...', subscriptionIdLogOptions);

            const encodedFulfillmentData = ethers.utils.defaultAbiCoder.encode(['int256'], [apiValue]);
            let conditionFunction: ethers.utils.FunctionFragment;
            let conditionParameters: string;
            try {
              const decodedConditions = abi.decode(conditions);
              const [decodedConditionFunctionId] = ethers.utils.defaultAbiCoder.decode(
                ['bytes32'],
                decodedConditions._conditionFunctionId
              );
              // TODO: is this really needed?
              // Airnode ABI only supports bytes32 but
              // function selector is '0x' plus 4 bytes and
              // that is why we need to ignore the trailing zeros
              conditionFunction = dapiServer.interface.getFunction(decodedConditionFunctionId.substring(0, 2 + 4 * 2));
              conditionParameters = decodedConditions._conditionParameters;
            } catch (err) {
              node.logger.error('Failed to decode conditions', {
                ...subscriptionIdLogOptions,
                error: err as any,
              });
              continue;
            }

            const [errorConditionFunction, [conditionsMet]] = await retryGo(() =>
              dapiServer
                .connect(voidSigner)
                .functions[conditionFunction.name](subscriptionId, encodedFulfillmentData, conditionParameters)
            );
            if (errorConditionFunction) {
              node.logger.error('Failed to check conditions', {
                ...subscriptionIdLogOptions,
                error: errorConditionFunction,
              });
              continue;
            }
            if (!conditionsMet) {
              node.logger.warn('Conditions not met. Skipping update...', subscriptionIdLogOptions);
              continue;
            }

            // **************************************************************************
            // Compute signature
            // **************************************************************************
            node.logger.debug('Signing fulfill message...', subscriptionIdLogOptions);

            const timestamp = Math.floor(Date.now() / 1000);

            const signature = await airnodeWallet.signMessage(
              ethers.utils.arrayify(
                ethers.utils.keccak256(
                  ethers.utils.solidityPack(
                    ['bytes32', 'uint256', 'address'],
                    [subscriptionId, timestamp, sponsorWallet.address]
                  )
                )
              )
            );

            // **************************************************************************
            // Update beacon
            // **************************************************************************
            node.logger.debug('Fulfilling subscription...', subscriptionIdLogOptions);

            let fulfillFunction: ethers.utils.FunctionFragment;
            try {
              fulfillFunction = dapiServer.interface.getFunction(fulfillFunctionId);
            } catch (error) {
              node.logger.error('Failed to get fulfill function', {
                ...subscriptionIdLogOptions,
                error: error as any,
              });
              continue;
            }
            const nonce = nextNonce++;
            const overrides = {
              gasLimit: GAS_LIMIT,
              ...gasTarget,
              nonce,
            };
            const [errfulfillFunction, tx] = await retryGo<ethers.ContractTransaction>(() =>
              dapiServer
                .connect(sponsorWallet)
                .functions[fulfillFunction.name](
                  subscriptionId,
                  airnodeAddress,
                  relayer,
                  sponsor,
                  timestamp,
                  encodedFulfillmentData,
                  signature,
                  overrides
                )
            );
            if (errfulfillFunction) {
              node.logger.error(
                `failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${nonce}`,
                {
                  ...subscriptionIdLogOptions,
                  error: errfulfillFunction,
                }
              );
              continue;
            }
            node.logger.info(`Tx submitted: ${tx?.hash}`, subscriptionIdLogOptions);
          }
        });

        await Promise.all(sponsorWalletPromises);
      })
    )
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  node.logger.info(
    `PSP beacon update finished at ${node.utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`,
    baseLogOptions
  );

  const response = {
    ok: true,
    data: { message: 'PSP beacon update execution has finished' },
  };
  return { statusCode: 200, body: JSON.stringify(response) };
};
