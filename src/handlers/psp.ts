import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import { callApi } from '../call-api';
import { loadAirnodeConfig, mergeConfigs, parseConfig } from '../config';
import { GAS_LIMIT } from '../constants';
import { ChainConfig, Config, FullSubscription, State } from '../types';
import { retryGo } from '../utils';
import { deriveSponsorWallet } from '../wallet';

//TODO: where to get abi from?
const dapiServerAbi = [
  'function conditionPspBeaconUpdate(bytes32,bytes,bytes) view returns (bool)',
  'function fulfillPspBeaconUpdate(bytes32,address,address,address,uint256,bytes,bytes)',
];

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  const airnodeConfig = loadAirnodeConfig();
  // This file will be merged with config.json from above
  const airkeeperConfig: Config = parseConfig('airkeeper');
  const config = mergeConfigs(airnodeConfig, airkeeperConfig);

  const coordinatorId = node.utils.randomHexString(8);
  const baseLogOptions = node.logger.buildBaseOptions(airnodeConfig, {
    coordinatorId,
  });
  node.logger.info(`PSP beacon update started at ${node.utils.formatDateTime(startedAt)}`, baseLogOptions);

  await updateBeacon(config, coordinatorId);

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

const initializeState = (config: Config, logOptions: any): State => {
  const { triggers, subscriptions } = config;

  const airnodeWallet = ethers.Wallet.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic);

  const enabledSubscriptions: FullSubscription[] = [];
  triggers['proto-psp'].forEach((subscriptionId) => {
    // Fetch subscriptions details
    const subscription = subscriptions[subscriptionId];
    if (isNil(subscription)) {
      node.logger.warn(`SubscriptionId ${subscriptionId} not found in subscriptions`, logOptions);
      return;
    }
    // Verify subscriptionId
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
        logOptions
      );
      return;
    }

    // TODO: should we also check that airnodeWallet.address === subscription.airnodeAddress? 🤔

    // Fetch template details
    const template = config.templates[subscription.templateId];
    if (isNil(template)) {
      node.logger.warn(`TemplateId ${subscription.templateId} not found in templates`, logOptions);
      return;
    }
    // Verify templateId
    const expectedTemplateId = ethers.utils.solidityKeccak256(
      ['bytes32', 'bytes'],
      [template.endpointId, template.templateParameters]
    );
    if (expectedTemplateId !== subscription.templateId) {
      node.logger.warn(
        `TemplateId ${subscription.templateId} does not match expected ${expectedTemplateId}`,
        logOptions
      );
      return;
    }

    // Fetch endpoint details
    const endpoint = config.endpoints[template.endpointId];
    if (isNil(endpoint)) {
      node.logger.warn(`EndpointId ${template.endpointId} not found in endpoints`, logOptions);
      return;
    }
    // Verify endpointId
    const expectedEndpointId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
    );
    if (expectedEndpointId !== template.endpointId) {
      node.logger.warn(`EndpointId ${template.endpointId} does not match expected ${expectedEndpointId}`, logOptions);
      return;
    }

    enabledSubscriptions.push({
      ...subscription,
      subscriptionId,
      template,
      endpoint,
    });
  });
  if (isEmpty(enabledSubscriptions)) {
    node.logger.info('No proto-psp subscriptions to process', logOptions);
  }

  return { config, logOptions, airnodeWallet, subscriptions: enabledSubscriptions };
};

const updateBeacon = async (config: Config, coordinatorId: string) => {
  const baseLogOptions = node.logger.buildBaseOptions(config, {
    coordinatorId,
  });

  // =================================================================
  // STEP 1: Initialize state
  // =================================================================
  node.logger.debug('Initializing state...', baseLogOptions);

  const initialState: State = initializeState(config, baseLogOptions);

  // **************************************************************************
  // STEP 2. Process chain providers in parallel
  // **************************************************************************
  node.logger.debug('Processing chain providers...', baseLogOptions);

  const evmChains = config.chains.filter((chain: ChainConfig) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: ChainConfig) =>
      map(chain.providers, async (chainProvider, providerName) => {
        const providerLogOptions: node.LogOptions = {
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

        node.logger.debug('Processing sponsor addresses...', providerLogOptions);

        // **************************************************************************
        // Filter subscription by chainId and group them by sponsor
        // **************************************************************************
        const chainSubscriptions = initialState.subscriptions.filter(
          (subscription) => subscription.chainId === chain.id
        );
        const subscriptionsBySponsor = groupBy(chainSubscriptions, 'sponsor');
        const sponsorAddresses = Object.keys(subscriptionsBySponsor);

        // Process each sponsor address in parallel
        const sponsorWalletPromises = sponsorAddresses.map(async (sponsor) => {
          // **************************************************************************
          // Derive sponsorWallet address
          // **************************************************************************
          node.logger.debug('Deriving sponsorWallet...', providerLogOptions);

          // TODO: switch to node.evm.deriveSponsorWallet when @api3/airnode-node allows setting the `protocolId`
          const sponsorWallet = deriveSponsorWallet(
            config.nodeSettings.airnodeWalletMnemonic,
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

          // Process each psp subscription in serial to keep nonces in order
          const sponsorSubscriptions = subscriptionsBySponsor[sponsor];
          for (const {
            subscriptionId,
            conditions,
            relayer,
            fulfillFunctionId,
            template,
            endpoint,
          } of sponsorSubscriptions || []) {
            const subscriptionIdLogOptions = {
              ...sponsorWalletLogOptions,
              additional: {
                ...sponsorWalletLogOptions.additional,
                subscriptionId,
              },
            };

            // **************************************************************************
            // Make API call
            // **************************************************************************
            node.logger.debug('Making API request...', subscriptionIdLogOptions);

            const apiCallParameters = abi.decode(template.templateParameters);
            const [errorCallApi, logsData] = await retryGo(() =>
              callApi({
                oises: config.ois,
                apiCredentials: config.apiCredentials,
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

            // TODO: Should we also include the condition contract address to be called in subscription.conditions
            //       and connect to that contract instead of dapiServer contract to call the conditionFunction?
            const [errorConditionFunction, result] = await retryGo(() =>
              dapiServer
                .connect(voidSigner)
                .functions[conditionFunction.name](subscriptionId, encodedFulfillmentData, conditionParameters)
            );
            if (errorConditionFunction || isNil(result)) {
              node.logger.error('Failed to check conditions', {
                ...subscriptionIdLogOptions,
                error: errorConditionFunction,
              });
              continue;
            }
            // The result will always be ethers.Result type even if solidity function retuns a single value
            // See https://docs.ethers.io/v5/api/contract/contract/#Contract-functionsCall
            if (!result[0]) {
              node.logger.warn('Conditions not met. Skipping update...', subscriptionIdLogOptions);
              continue;
            }

            // **************************************************************************
            // Compute signature
            // **************************************************************************
            node.logger.debug('Signing fulfill message...', subscriptionIdLogOptions);

            const timestamp = Math.floor(Date.now() / 1000);

            const signature = await initialState.airnodeWallet.signMessage(
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
                  initialState.airnodeWallet.address,
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
};
