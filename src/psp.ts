import * as path from 'path';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import merge from 'lodash/merge';
import { parseConfig, retryGo } from './utils';
import { PspChainConfig, PspConfig } from './types';
import { readApiValue } from './call-api';

function deriveWalletPathFromSponsorAddress(sponsorAddress: string, protocolId: string) {
  const sponsorAddressBN = ethers.BigNumber.from(sponsorAddress);
  const paths = [];
  for (let i = 0; i < 6; i++) {
    const shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
    paths.push(shiftedSponsorAddressBN.mask(31).toString());
  }
  return `${protocolId}/${paths.join('/')}`;
}

function deriveSponsorWallet(airnodeMnemonic: string, sponsorAddress: string, protocolId: string) {
  return ethers.Wallet.fromMnemonic(
    airnodeMnemonic,
    `m/44'/60'/0'/${deriveWalletPathFromSponsorAddress(sponsorAddress, protocolId)}`
  );
}

function nowInSeconds() {
  return Math.floor(Date.now() / 1000);
}

export const beaconUpdate = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  // This file must be the same as the one used by the @api3/airnode-node
  const nodeConfigPath = path.resolve(__dirname, '..', '..', 'config', `config.json`);
  const nodeConfig = node.config.parseConfig(nodeConfigPath, process.env);
  // This file will be merged with config.json from above
  const pspConfig: PspConfig = parseConfig('psp');

  const baseLogOptions = node.logger.buildBaseOptions(nodeConfig, {
    coordinatorId: node.utils.randomString(8),
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
  };
  const { chains, nodeSettings, triggers, ois: oises, apiCredentials } = config;

  const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(nodeSettings.airnodeWalletMnemonic);
  const airnodeAddress = airnodeHDNode.derivePath(ethers.utils.defaultPath).address;

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

        // **************************************************************************
        // Fetch subscriptions from allocators
        // **************************************************************************
        node.logger.debug('Fetching subcriptions...', providerLogOptions);

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

        const subscriptionIds: string[] = [];
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

        // **************************************************************************
        // Process each psp subscription in serial to keep nonces in order
        // **************************************************************************
        for (const subscriptionId of subscriptionIds) {
          const subscriptionIdLogOptions = {
            ...providerLogOptions,
            additional: {
              subscriptionId,
            },
          };

          // **************************************************************************
          // Fetch subscription details
          // **************************************************************************
          node.logger.debug('Fetching subscription details...', subscriptionIdLogOptions);

          // On-chain details: AirnodeProtocol.subscriptions(id)
          // Off-chain details: triggers.psp
          const subscription = triggers.psp.find((s) => {
            // TODO: Should the config contain subscriptionId field
            // or should we derive it using the other fields to verify
            // that values in config are correct?
            return s.subscriptionId === subscriptionId;
          });
          if (isNil(subscription)) {
            node.logger.warn('Subscription not found in triggers.psp', subscriptionIdLogOptions);
            continue;
          }

          // **************************************************************************
          // Check sponsorship status
          // **************************************************************************
          node.logger.debug('Checking sponsorship status...', subscriptionIdLogOptions);

          if (!airnodeProtocol.sponsorToSubscriptionIdToPspSponsorshipStatus(subscription.sponsor, subscriptionId)) {
            node.logger.info('Subscription not sponsored', subscriptionIdLogOptions);
            continue;
          }

          // **************************************************************************
          // Check authorization status
          // **************************************************************************
          node.logger.debug('Checking authorization status...', subscriptionIdLogOptions);

          // TODO: This needs a little bit of thinking 🤔
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

          // **************************************************************************
          // Make API call
          // **************************************************************************
          node.logger.debug('Making API requests...', subscriptionIdLogOptions);

          const [error, logsData] = await retryGo(() =>
            readApiValue({
              airnodeAddress,
              oises,
              apiCredentials,
              id: subscriptionId,
              trigger: subscription,
            })
          );
          if (!isNil(error) || isNil(logsData)) {
            node.logger.warn('Failed to fecth API value', subscriptionIdLogOptions);
            continue;
          }
          const [logs, data] = logsData;
          node.logger.logPending(logs, subscriptionIdLogOptions);

          const apiValue = data[subscriptionId];
          if (isNil(apiValue)) {
            node.logger.warn('API value is missing. Skipping update...', subscriptionIdLogOptions);
            continue;
          }

          // **************************************************************************
          // Check conditions
          // **************************************************************************
          node.logger.debug('Checking conditions...', subscriptionIdLogOptions);

          // Is this step really needed?
          // https://github.com/api3dao/airnode/blob/v1-protocol/packages/airnode-protocol-v1/contracts/dapis/DapiServer.sol#L20-L23

          const encodedFulfillmentData = ethers.utils.defaultAbiCoder.encode(['int256'], [apiValue]);

          // TODO: Should "subscription.conditions" be already encoded in config?
          // const encodedConditionParameters = ethers.utils.defaultAbiCoder.encode(
          //   ['uint256'],
          //   [subscription.conditions] // How is this supposed to be set in config? i.e. (10**18 / 10) for 10%?
          // );

          const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
          // TODO: retryGo?
          if (
            !(await dapiServer
              .connect(voidSigner)
              .conditionPspBeaconUpdate(subscriptionId, encodedFulfillmentData, subscription.conditions))
          ) {
            node.logger.warn('Conditions not met. Skipping update...', subscriptionIdLogOptions);
            continue;
          }
          node.logger.info('Conditions met. Updating beacon...', subscriptionIdLogOptions);

          // **************************************************************************
          // Compute signature
          // **************************************************************************
          node.logger.debug('Signing fulfill message...', subscriptionIdLogOptions);

          const airnodeWallet = ethers.Wallet.fromMnemonic(nodeSettings.airnodeWalletMnemonic).connect(provider);
          // TODO: protocol parameter is missing in v0.3.1
          // const sponsorWallet = node.evm.deriveSponsorWallet(airnodeHDNode, subscription.sponsor).connect(provider);
          const sponsorWallet = deriveSponsorWallet(
            nodeSettings.airnodeWalletMnemonic,
            subscription.sponsor,
            '2'
          ).connect(provider);

          const timestamp = nowInSeconds();

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

          // TODO: what if there is a previous pending fulfillPspBeaconUpdate (or any pending?) tx for this sponsor wallet?

          // TODO: retryGo?
          await dapiServer
            .connect(sponsorWallet)
            .fulfillPspBeaconUpdate(
              subscriptionId,
              airnodeAddress,
              subscription.relayer,
              subscription.sponsor,
              timestamp,
              encodedFulfillmentData,
              signature
            );
        }
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
