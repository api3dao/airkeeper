import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import merge from 'lodash/merge';
import { callApi as callApi } from './call-api';
import { ChainConfig, Config, PspTrigger, Subscription } from './types';
import { deriveSponsorWallet, loadNodeConfig, parseConfig, retryGo } from './utils';

export const GAS_LIMIT = 500_000;

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
  };
  const { chains, nodeSettings, triggers, ois: oises, apiCredentials, subscriptions, templates } = config;

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

        // Fetch current block number from chain via provider
        const [errorGetBlockNumber, currentBlock] = await retryGo(() => provider.getBlockNumber());
        if (errorGetBlockNumber || isNil(currentBlock)) {
          node.logger.error('Failed to fetch the blockNumber', {
            ...providerLogOptions,
            error: errorGetBlockNumber,
          });
          return;
        }

        const dapiServer = new ethers.Contract(chain.contracts.DapiServer, dapiServerAbi, provider);

        const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

        // **************************************************************************
        // Fetch subscriptions details
        // **************************************************************************
        node.logger.debug('Fetching subscriptions details...', providerLogOptions);

        const pspTriggersWithSubscriptions: (PspTrigger & Subscription)[] = [];
        triggers['proto-psp'].forEach((pspTrigger) => {
          const subscription = subscriptions[pspTrigger.subscriptionId];
          if (isNil(subscription)) {
            node.logger.warn(
              `SubscriptionId ${pspTrigger.subscriptionId} not found in subscriptions`,
              providerLogOptions
            );
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
          if (pspTrigger.subscriptionId !== expectedSubscriptionId) {
            node.logger.warn(
              `SubscriptionId ${pspTrigger.subscriptionId} does not match expected ${expectedSubscriptionId}`,
              providerLogOptions
            );
            return;
          }

          pspTriggersWithSubscriptions.push({
            ...pspTrigger,
            ...subscription,
          });
        });
        if (isEmpty(pspTriggersWithSubscriptions)) {
          node.logger.info('No proto-psp subscriptions to process', providerLogOptions);
          return;
        }

        // **************************************************************************
        // Process each sponsor address in parallel
        // **************************************************************************
        node.logger.debug('Processing sponsor addresses...', providerLogOptions);

        const pspTriggersWithSubscriptionsBySponsor = groupBy(pspTriggersWithSubscriptions, 'sponsor');
        const sponsorAddresses = Object.keys(pspTriggersWithSubscriptionsBySponsor);

        const sponsorWalletPromises = sponsorAddresses.map(async (sponsor) => {
          // **************************************************************************
          // Derive sponsorWallet address
          // **************************************************************************
          node.logger.debug('Deriving sponsorWallet...', providerLogOptions);

          // TODO: switch to node.evm.deriveSponsorWallet when @api3/airnode-node allows setting the `protocolId`
          const sponsorWallet = deriveSponsorWallet(
            nodeSettings.airnodeWalletMnemonic,
            sponsor,
            '3' // TODO: should this be in a centralized enum somewhere (api3/airnode-protocol maybe)?
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
          let nonce = sponsorWalletTransactionCount;

          // **************************************************************************
          // Process each psp subscription in serial to keep nonces in order
          // **************************************************************************
          node.logger.debug('Processing rrpBeaconServerKeeperJobs...', sponsorWalletLogOptions);

          const sponsorPspTriggersWithSubscriptions = pspTriggersWithSubscriptionsBySponsor[sponsor];
          for (const {
            overrideParameters,
            oisTitle,
            endpointName,
            subscriptionId,
            templateId,
            conditions,
            relayer,
            fulfillFunctionId,
          } of sponsorPspTriggersWithSubscriptions || []) {
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
            // Make API call
            // **************************************************************************
            node.logger.debug('Making API request...', subscriptionIdLogOptions);

            const [errorCallApi, logsData] = await retryGo(() =>
              callApi({
                airnodeAddress,
                oises,
                apiCredentials,
                id: subscriptionId,
                templateId,
                overrideParameters,
                oisTitle,
                endpointName,
                endpointId: template.endpointId,
                templateParameters: template.templateParameters,
              })
            );
            if (!isNil(errorCallApi) || isNil(logsData)) {
              node.logger.warn('Failed to fecth API value', subscriptionIdLogOptions);
              continue;
            }
            const [logs, data] = logsData;
            node.logger.logPending(logs, subscriptionIdLogOptions);

            const apiValue = data[subscriptionId];
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
                ['bytes4'],
                decodedConditions._conditionFunctionId
              );
              conditionFunction = dapiServer.interface.getFunction(decodedConditionFunctionId);
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
            // Fetch current gas fee data
            // **************************************************************************
            node.logger.debug('Fetching gas price...', subscriptionIdLogOptions);

            const [gasPriceLogs, gasTarget] = await node.evm.getGasPrice({
              provider,
              chainOptions: chain.options,
            });
            if (!isEmpty(gasPriceLogs)) {
              node.logger.logPending(gasPriceLogs, subscriptionIdLogOptions);
            }
            if (!gasTarget) {
              node.logger.warn('Failed to fetch gas price. Skipping update...', subscriptionIdLogOptions);
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
            const currentNonce = nonce;
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
                  {
                    gasLimit: GAS_LIMIT,
                    ...gasTarget,
                    nonce: nonce++,
                  }
                )
            );
            if (errfulfillFunction) {
              node.logger.error(
                `failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${currentNonce}`,
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
