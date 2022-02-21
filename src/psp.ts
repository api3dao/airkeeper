import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import merge from 'lodash/merge';
import pick from 'lodash/pick';
import { readApiValue } from './call-api';
import { PspChainConfig, PspConfig, Subscription } from './types';
import { deriveSponsorWallet, loadNodeConfig, parseConfig, retryGo } from './utils';

export const beaconUpdate = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  const nodeConfig = loadNodeConfig();
  // This file will be merged with config.json from above
  const pspConfig: PspConfig = parseConfig('psp');

  const baseLogOptions = node.logger.buildBaseOptions(nodeConfig, {
    coordinatorId: node.utils.randomHexString(8),
  });
  node.logger.info(`PSP beacon update started at ${node.utils.formatDateTime(startedAt)}`, baseLogOptions);

  const { chains: pspChains, triggers: pspTriggers } = pspConfig;
  const config = {
    ...nodeConfig,
    chains: pspChains.map((chain) => {
      if (isNil(chain.id)) {
        throw new Error(`Missing 'id' property in chain config: ${JSON.stringify(chain)}`);
      }
      const configChain = nodeConfig.chains.find((c) => c.id === chain.id);
      if (isNil(configChain)) {
        throw new Error(`Chain id ${chain.id} not found in node config.json`);
      }
      return merge(configChain, chain);
    }),
    triggers: { ...nodeConfig.triggers, ...pspTriggers },
    ...pick(pspConfig, ['subscriptions', 'templates']),
  };
  const { chains, nodeSettings, triggers, subscriptions, templates, ois: oises, apiCredentials } = config;

  const airnodeWallet = ethers.Wallet.fromMnemonic(nodeSettings.airnodeWalletMnemonic);
  const { address: airnodeAddress } = airnodeWallet;

  // **************************************************************************
  // 2. Process chain providers in parallel
  // **************************************************************************
  node.logger.debug('Processing chain providers...', baseLogOptions);

  const evmChains = chains.filter((chain: PspChainConfig) => chain.type === 'evm');
  if (isEmpty(chains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: PspChainConfig) =>
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
        const [err, currentBlock] = await retryGo(() => provider.getBlockNumber());
        if (err || isNil(currentBlock)) {
          node.logger.error('failed to fetch the blockNumber', {
            ...providerLogOptions,
            error: err,
          });
          return;
        }

        /*
        //TODO: where to get abi from?
        const airnodeProtocolAbi = [
          {
            inputs: [
              {
                internalType: 'address',
                name: '',
                type: 'address',
              },
              {
                internalType: 'bytes32',
                name: '',
                type: 'bytes32',
              },
            ],
            name: 'sponsorToSubscriptionIdToPspSponsorshipStatus',
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
        ];
        const airnodeProtocol = new ethers.Contract(chain.contracts.AirnodeProtocol, airnodeProtocolAbi, provider);
        */

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
        const dapiServer = new ethers.Contract(chain.contracts.DapiServer, dapiServerAbi, provider);

        const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

        /* 
        // **************************************************************************
        // Fetch subscriptions from allocators
        // DISABLED: https://github.com/api3dao/airkeeper/pull/28#discussion_r808586658
        // **************************************************************************
        node.logger.debug('Fetching subcriptions...', providerLogOptions);

        
        const subscriptionIds: string[] = [];
        //TODO: where to get abi from?
        const allocatorAbi = [
          {
            inputs: [
              {
                internalType: 'address',
                name: '',
                type: 'address',
              },
              {
                internalType: 'uint256',
                name: '',
                type: 'uint256',
              },
            ],
            name: 'airnodeToSlotIndexToSlot',
            outputs: [
              {
                internalType: 'bytes32',
                name: 'subscriptionId',
                type: 'bytes32',
              },
              {
                internalType: 'address',
                name: 'setter',
                type: 'address',
              },
              {
                internalType: 'uint64',
                name: 'expirationTimestamp',
                type: 'uint64',
              },
            ],
            stateMutability: 'view',
            type: 'function',
          },
          {
            inputs: [
              {
                internalType: 'bytes[]',
                name: 'data',
                type: 'bytes[]',
              },
            ],
            name: 'multicall',
            outputs: [
              {
                internalType: 'bytes[]',
                name: 'results',
                type: 'bytes[]',
              },
            ],
            stateMutability: 'nonpayable',
            type: 'function',
          },
        ];
        for (const { address, startIndex, endIndex } of chain.allocators) {
          const allocator = new ethers.Contract(address, allocatorAbi, provider);
          const staticCalldatas = [];
          for (let i = startIndex; i <= endIndex; i++) {
            staticCalldatas.push(
              allocator.interface.encodeFunctionData('airnodeToSlotIndexToSlot', [airnodeAddress, i])
            );
          }
          // TODO: retryGo?
          const resultDatas = await allocator.callStatic.multicall(staticCalldatas);
          resultDatas.forEach((resultData: ethers.utils.BytesLike) => {
            const result = allocator.interface.decodeFunctionResult('airnodeToSlotIndexToSlot', resultData);
            if (result.subscriptionId && result.expirationTimestamp.gt(nowInSeconds())) {
              subscriptionIds.push(result.subscriptionId);
            }
          });
        }
        */

        // **************************************************************************
        // Process each sponsor address in parallel
        // **************************************************************************
        node.logger.debug('processing sponsor addresses...', providerLogOptions);

        const protoSubscriptions: (Subscription & { id: string })[] = [];
        triggers['proto-psp'].forEach((subscriptionId) => {
          // **************************************************************************
          // Fetch subscription details
          // **************************************************************************
          node.logger.debug('Fetching subscription details...', providerLogOptions);

          const subscription = subscriptions[subscriptionId];
          if (isNil(subscription)) {
            node.logger.warn(`SubscriptionId ${subscriptionId} not found in subscriptions`, providerLogOptions);
            return;
          }

          // **************************************************************************
          // Verify subscriptionId
          // **************************************************************************
          node.logger.debug('Verifying subscriptionId...', providerLogOptions);

          const expectedSubscriptionId = ethers.utils.keccak256(
            ethers.utils.solidityPack(
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
            )
          );
          if (subscriptionId !== expectedSubscriptionId) {
            node.logger.warn(
              `SubscriptionId ${subscriptionId} does not match expected ${expectedSubscriptionId}`,
              providerLogOptions
            );
            return;
          }

          protoSubscriptions.push({ id: subscriptionId, ...subscription });
        });
        if (isEmpty(protoSubscriptions)) {
          node.logger.debug('No proto-psp subscriptions to process', providerLogOptions);
          return;
        }

        const subscriptionsBySponsor = groupBy(protoSubscriptions, 'sponsor');
        const sponsorAddresses = Object.keys(subscriptionsBySponsor);

        const sponsorWalletPromises = sponsorAddresses.map(async (sponsor) => {
          // **************************************************************************
          // Derive sponsorWallet address
          // **************************************************************************
          node.logger.debug('deriving sponsorWallet...', providerLogOptions);

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
          node.logger.debug('fetching transaction count...', sponsorWalletLogOptions);

          const [err, sponsorWalletTransactionCount] = await retryGo(() =>
            provider.getTransactionCount(sponsorWallet.address, currentBlock)
          );
          if (err || isNil(sponsorWalletTransactionCount)) {
            node.logger.error('failed to fetch the sponsor wallet transaction count', {
              ...sponsorWalletLogOptions,
              error: err,
            });
            return;
          }
          let nonce = sponsorWalletTransactionCount;

          // **************************************************************************
          // Process each psp subscription in serial to keep nonces in order
          // **************************************************************************
          node.logger.debug('processing rrpBeaconServerKeeperJobs...', sponsorWalletLogOptions);

          const sponsorSubscriptions = subscriptionsBySponsor[sponsor];
          for (const subscription of sponsorSubscriptions || []) {
            const subscriptionIdLogOptions = {
              ...sponsorWalletLogOptions,
              additional: {
                ...sponsorWalletLogOptions.additional,
                subscriptionId: subscription.id,
              },
            };

            // **************************************************************************
            // Fetch template details
            // **************************************************************************
            node.logger.debug('Fetching template details...', subscriptionIdLogOptions);

            const template = templates[subscription.templateId];
            if (isNil(template)) {
              node.logger.warn('Template not found in config', subscriptionIdLogOptions);
              continue;
            }

            /* 
          // **************************************************************************
          // Check sponsorship status
          // DISABLED: https://github.com/api3dao/airkeeper/pull/28#discussion_r808586658
          // **************************************************************************
          node.logger.debug('Checking sponsorship status...', subscriptionIdLogOptions);

          if (!airnodeProtocol.sponsorToSubscriptionIdToPspSponsorshipStatus(subscription.sponsor, subscriptionId)) {
            node.logger.info('Subscription not sponsored', subscriptionIdLogOptions);
            continue;
          }
          */

            /* 
          // **************************************************************************
          // Check authorization status
          // DISABLED: https://github.com/api3dao/airkeeper/pull/28#discussion_r808586658
          // **************************************************************************
          node.logger.debug('Checking authorization status...', subscriptionIdLogOptions);

          // This needs a little bit of thinking 🤔
          // By default subscription.requester is set to the dapiServer address when calling dapiServer.registerBeaconUpdateSubscription()
          // Reference: airnode/packages/airnode-node/src/evm/authorization/authorization-fetching.ts
          const endpointId = ethers.utils.keccak256(
            ethers.utils.defaultAbiCoder.encode(
              ['string', 'string'],
              [subscription.oisTitle, subscription.endpointName]
            )
          );
          const authorizerAbi = [
            {
              inputs: [
                {
                  internalType: 'address',
                  name: 'airnode',
                  type: 'address',
                },
                {
                  internalType: 'bytes32',
                  name: 'endpointId',
                  type: 'bytes32',
                },
                {
                  internalType: 'address',
                  name: 'requester',
                  type: 'address',
                },
              ],
              name: 'isAuthorized',
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
          ];
          const authorizesRequesterForAirnodeEndpoint = async (authorizerAddress: string): Promise<any> => {
            const authorizer = new ethers.Contract(authorizerAddress, authorizerAbi, provider);
            return await authorizer.isAuthorized(airnodeAddress, endpointId, subscription.requester);
          };
          const authorized =
            isEmpty(chain.authorizers) || chain.authorizers.some(authorizesRequesterForAirnodeEndpoint);
          if (!authorized) {
            node.logger.info('Requester not authorized', subscriptionIdLogOptions);
            continue;
          }
          */

            // **************************************************************************
            // Make API call
            // **************************************************************************
            node.logger.debug('Making API request...', subscriptionIdLogOptions);

            const [error, logsData] = await retryGo(() =>
              readApiValue({
                airnodeAddress,
                oises,
                apiCredentials,
                id: subscription.id,
                ...{ templateId: subscription.templateId, ...template },
              })
            );
            if (!isNil(error) || isNil(logsData)) {
              node.logger.warn('Failed to fecth API value', subscriptionIdLogOptions);
              continue;
            }
            const [logs, data] = logsData;
            node.logger.logPending(logs, subscriptionIdLogOptions);

            const apiValue = data[subscription.id];
            if (isNil(apiValue)) {
              node.logger.warn('API value is missing. Skipping update...', subscriptionIdLogOptions);
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
              const decodedConditions = abi.decode(subscription.conditions);
              const decodedFunctionId = ethers.utils.defaultAbiCoder.decode(
                ['bytes4'],
                decodedConditions._conditionFunctionId
              );
              conditionFunction = dapiServer.interface.getFunction(decodedFunctionId.toString());
              conditionParameters = decodedConditions._conditionParameters;
            } catch (err) {
              node.logger.error('Failed to decode conditions', {
                ...subscriptionIdLogOptions,
                error: err as any,
              });
              continue;
            }
            const [err, [conditionsMet]] = await retryGo(() =>
              dapiServer
                .connect(voidSigner)
                .functions[conditionFunction.name](subscription.id, encodedFulfillmentData, conditionParameters)
            );
            if (err) {
              node.logger.error('Failed to check conditions', { ...subscriptionIdLogOptions, error: err });
              continue;
            }
            if (!conditionsMet) {
              node.logger.warn('Conditions not met. Skipping update...', subscriptionIdLogOptions);
              continue;
            }
            node.logger.info('Conditions met. Updating beacon...', subscriptionIdLogOptions);

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
                    [subscription.id, timestamp, sponsorWallet.address]
                  )
                )
              )
            );

            // **************************************************************************
            // Update beacon
            // **************************************************************************
            node.logger.debug('Fulfilling subscription...', subscriptionIdLogOptions);

            // TODO: add gas price using override but use @api3/airnode-node/src/evm/gas-price.ts
            const currentNonce = nonce;
            const [errFulfillPspBeaconUpdate, tx] = await retryGo<ethers.ContractTransaction>(() =>
              dapiServer
                .connect(sponsorWallet)
                .fulfillPspBeaconUpdate(
                  subscription.id,
                  airnodeAddress,
                  subscription.relayer,
                  subscription.sponsor,
                  timestamp,
                  encodedFulfillmentData,
                  signature,
                  {
                    nonce: nonce++,
                  }
                )
            );
            if (errFulfillPspBeaconUpdate) {
              node.logger.error(
                `failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${currentNonce}. Skipping update`,
                {
                  ...subscriptionIdLogOptions,
                  error: errFulfillPspBeaconUpdate,
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
