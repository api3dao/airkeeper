import * as path from 'path';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as protocol from '@api3/airnode-protocol';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import merge from 'lodash/merge';
import { readApiValue } from './call-api';
// TODO: use node.evm.getGasPrice() once @api3/airnode-node is updated to v0.4.x
import { getGasPrice } from './gas-prices';
import { ChainConfig, Config, LogsAndApiValuesByBeaconId } from './types';
import { deriveKeeperSponsorWallet, parseConfig, retryGo } from './utils';
import 'source-map-support/register';

export const GAS_LIMIT = 500_000;
export const BLOCK_COUNT_HISTORY_LIMIT = 300;

export const beaconUpdate = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  // This file must be the same as the one used by the node
  const nodeConfigPath = path.resolve(__dirname, '..', '..', 'config', `config.json`);
  const nodeConfig = node.config.parseConfig(nodeConfigPath, process.env);
  // This file will be merged with config.json from above
  const keeperConfig: Config = parseConfig('airkeeper');

  const baseLogOptions = node.logger.buildBaseOptions(nodeConfig, {
    coordinatorId: node.utils.randomString(8),
  });
  node.logger.info(`Airkeeper started at ${node.utils.formatDateTime(startedAt)}`, baseLogOptions);

  const config = {
    ...nodeConfig,
    chains: keeperConfig.chains.map((chain) => {
      if (isNil(chain.id)) {
        throw new Error(`Missing 'id' property in chain config: ${JSON.stringify(chain)}`);
      }
      const configChain = nodeConfig.chains.find((c) => c.id === chain.id);
      if (isNil(configChain)) {
        throw new Error(`Chain id ${chain.id} not found in node config.json`);
      }
      return merge(configChain, chain);
    }),
    triggers: { ...nodeConfig.triggers, ...keeperConfig.triggers },
  };
  const { chains, triggers, ois: oises, apiCredentials } = config;

  const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic);
  const airnodeAddress = (
    keeperConfig.airnodeXpub
      ? ethers.utils.HDNode.fromExtendedKey(keeperConfig.airnodeXpub).derivePath('0/0')
      : airnodeHDNode.derivePath(ethers.utils.defaultPath)
  ).address;

  if (keeperConfig.airnodeAddress && keeperConfig.airnodeAddress !== airnodeAddress) {
    throw new Error(`xpub does not belong to Airnode: ${airnodeAddress}`);
  }

  // **************************************************************************
  // 2. Read and cache API values
  // **************************************************************************
  node.logger.debug('making API requests...', baseLogOptions);

  const apiValuePromises = triggers.rrpBeaconServerKeeperJobs.map((trigger) =>
    retryGo(() => {
      const encodedParameters = abi.encode([...trigger.templateParameters, ...trigger.overrideParameters]);
      const beaconId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [trigger.templateId, encodedParameters]);
      return readApiValue({ airnodeAddress, oises, apiCredentials, id: beaconId, trigger });
    })
  );
  const responses = await Promise.all(apiValuePromises);

  // Group logs and API values by beaconId
  const logsAndApiValuesByBeaconId: LogsAndApiValuesByBeaconId = responses.reduce((acc, [, logsData]) => {
    if (isNil(logsData)) {
      return acc;
    }
    const [logs, data] = logsData;
    const [beaconId] = Object.keys(data);
    return { ...acc, ...{ [beaconId]: { logs, apiValue: data[beaconId] } } };
  }, {});

  // Print pending logs
  Object.keys(logsAndApiValuesByBeaconId).forEach((beaconId) =>
    node.logger.logPending(logsAndApiValuesByBeaconId[beaconId].logs, {
      ...baseLogOptions,
      additional: { beaconId },
    })
  );

  // **************************************************************************
  // 3. Process chain providers in parallel
  // **************************************************************************
  node.logger.debug('processing chain providers...', baseLogOptions);

  const evmChains = chains.filter((chain: node.ChainConfig & ChainConfig) => chain.type === 'evm');
  if (isEmpty(chains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: node.ChainConfig & ChainConfig) => {
      return map(chain.providers, async (chainProvider, providerName) => {
        const providerLogOptions = {
          ...baseLogOptions,
          meta: {
            ...baseLogOptions.meta,
            providerName,
            chainId: chain.id,
          },
        };

        // **************************************************************************
        // 3.1 Initialize provider specific data
        // **************************************************************************
        node.logger.debug('initializing...', providerLogOptions);

        const blockHistoryLimit = chain.blockHistoryLimit || BLOCK_COUNT_HISTORY_LIMIT;
        const chainProviderUrl = chainProvider.url || '';
        const provider = node.evm.buildEVMProvider(chainProviderUrl, chain.id);

        const airnodeRrp = protocol.AirnodeRrpFactory.connect(chain.contracts.AirnodeRrp, provider);

        const rrpBeaconServer = protocol.RrpBeaconServerFactory.connect(chain.contracts.RrpBeaconServer, provider);

        // Fetch current block number from chain via provider
        const [err, currentBlock] = await retryGo(() => provider.getBlockNumber());
        if (err || isNil(currentBlock)) {
          node.logger.error('failed to fetch the blockNumber', {
            ...providerLogOptions,
            error: err,
          });
          return;
        }

        // **************************************************************************
        // 3.2 Process each keeperSponsor address in parallel
        // **************************************************************************
        node.logger.debug('processing keeperSponsor addresses...', providerLogOptions);

        // Group rrpBeaconServerKeeperJobs by keeperSponsor
        const rrpBeaconServerKeeperJobsByKeeperSponsor = groupBy(triggers.rrpBeaconServerKeeperJobs, 'keeperSponsor');
        const keeperSponsorAddresses = Object.keys(rrpBeaconServerKeeperJobsByKeeperSponsor);

        const keeperSponsorWalletPromises = keeperSponsorAddresses.map(async (keeperSponsor) => {
          // **************************************************************************
          // 3.2.1 Derive keeperSponsorWallet address
          // **************************************************************************
          node.logger.debug('deriving keeperSponsorWallet...', providerLogOptions);

          const keeperSponsorWallet = deriveKeeperSponsorWallet(airnodeHDNode, keeperSponsor, provider);

          const keeperSponsorWalletLogOptions = {
            ...providerLogOptions,
            additional: {
              keeperSponsorWallet: keeperSponsorWallet.address.replace(
                keeperSponsorWallet.address.substring(5, 38),
                '...'
              ),
            },
          };

          // **************************************************************************
          // 3.2.2 Fetch keeperSponsorWallet transaction count
          // **************************************************************************
          node.logger.debug('fetching transaction count...', keeperSponsorWalletLogOptions);

          const [err, keeperSponsorWalletTransactionCount] = await retryGo(() =>
            provider.getTransactionCount(keeperSponsorWallet.address, currentBlock)
          );
          if (err || isNil(keeperSponsorWalletTransactionCount)) {
            node.logger.error('failed to fetch the keeperSponsorWallet transaction count', {
              ...keeperSponsorWalletLogOptions,
              error: err,
            });
            return;
          }
          let nonce = keeperSponsorWalletTransactionCount;

          // **************************************************************************
          // 3.2.3 Process each rrpBeaconServerKeeperJob in serial to keep nonces in order
          // **************************************************************************
          node.logger.debug('processing rrpBeaconServerKeeperJobs...', keeperSponsorWalletLogOptions);

          const rrpBeaconServerKeeperJobs = rrpBeaconServerKeeperJobsByKeeperSponsor[keeperSponsor];
          for (const {
            chainIds,
            templateId,
            overrideParameters,
            templateParameters,
            deviationPercentage,
            requestSponsor,
          } of rrpBeaconServerKeeperJobs) {
            const configParameters = [...templateParameters, ...overrideParameters];
            // **************************************************************************
            // 3.2.3.1 Derive beaconId
            // **************************************************************************
            node.logger.debug('deriving beaconId...', keeperSponsorWalletLogOptions);

            const encodedParameters = abi.encode(configParameters);
            const beaconId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [templateId, encodedParameters]);

            const beaconIdLogOptions = {
              ...keeperSponsorWalletLogOptions,
              additional: {
                ...keeperSponsorWalletLogOptions.additional,
                beaconId,
              },
            };

            // **************************************************************************
            // 3.2.3.2 Verify if beacon must be updated for current chain
            // **************************************************************************
            node.logger.debug('verifying if beacon must be updated for current chain...', beaconIdLogOptions);

            // If chainIds is not defined, beacon must be updated to keep backward compatibility
            if (chainIds && !chainIds.includes(chain.id)) {
              node.logger.debug('skipping beaconId as it is not for current chain', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.3 Read API value from cache
            // **************************************************************************
            node.logger.debug('looking for API value...', beaconIdLogOptions);

            const apiValue = logsAndApiValuesByBeaconId[beaconId].apiValue;
            if (isNil(apiValue)) {
              node.logger.warn('API value is missing. skipping update', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.4 Verify deviationPercentage is between 0 and 100 and has only 2 decimal places
            // **************************************************************************
            node.logger.debug('verifying deviationPercentage...', beaconIdLogOptions);

            if (
              isNaN(Number(deviationPercentage)) ||
              Number(deviationPercentage) <= 0 ||
              Number(deviationPercentage) > 100 ||
              !Number.isInteger(Number(deviationPercentage) * 100) // Only 2 decimal places is allowed
            ) {
              node.logger.error(
                `deviationPercentage '${deviationPercentage}' must be a number larger than 0 and less then or equal to 100 with no more than 2 decimal places`,
                beaconIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // 3.2.3.5 Read beacon
            // **************************************************************************
            node.logger.debug('reading beacon value...', beaconIdLogOptions);

            // address(0) is considered whitelisted
            const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
            const [errReadBeacon, beaconResponse] = await retryGo(() =>
              rrpBeaconServer.connect(voidSigner).readBeacon(beaconId)
            );
            if (errReadBeacon || isNil(beaconResponse) || isNil(beaconResponse.value)) {
              node.logger.error(`failed to read value for beaconId: ${beaconId}`, {
                ...beaconIdLogOptions,
                error: errReadBeacon,
              });
              continue;
            }
            node.logger.info(`beacon server value: ${beaconResponse.value.toString()}`, beaconIdLogOptions);

            // **************************************************************************
            // 3.2.3.6 Calculate deviation
            // **************************************************************************
            node.logger.debug('calculating deviation...', beaconIdLogOptions);

            let beaconValue = beaconResponse.value;
            const delta = beaconValue.sub(apiValue!).abs();
            if (delta.eq(0)) {
              node.logger.warn('beacon is up-to-date. skipping update', beaconIdLogOptions);
              continue;
            }
            beaconValue = beaconResponse.value.isZero() ? ethers.constants.One : beaconResponse.value;
            const basisPoints = ethers.utils.parseUnits('1', 16);
            const deviation = delta.mul(basisPoints).mul(100).div(beaconValue);
            node.logger.info(`deviation (%): ${ethers.utils.formatUnits(deviation, 16)}`, beaconIdLogOptions);

            // **************************************************************************
            // 3.2.3.7 Check if deviation is within the threshold
            // **************************************************************************
            node.logger.debug('checking deviation...', beaconIdLogOptions);

            const percentageThreshold = basisPoints.mul(
              Number(deviationPercentage) * 100 // support for percentages up to 2 decimal places
            );
            if (deviation.lte(percentageThreshold.div(100))) {
              node.logger.warn(
                'delta between beacon value and API value is within threshold. skipping update',
                beaconIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // 3.2.3.8 Fetch previous events to determine if previous update tx is pending
            // **************************************************************************
            node.logger.debug('checking previous txs...', beaconIdLogOptions);

            // Check to prevent sending the same request for beacon update more than once
            // by checking if a RequestedBeaconUpdate event was emitted but no matching
            // UpdatedBeacon event was emitted.

            // Fetch RequestedBeaconUpdate events by beaconId, sponsor and sponsorWallet
            const requestedBeaconUpdateFilter = rrpBeaconServer.filters.RequestedBeaconUpdate(
              beaconId,
              requestSponsor,
              keeperSponsorWallet.address
            );
            const [errRequestedBeaconUpdateFilter, requestedBeaconUpdateEvents] = await retryGo(() =>
              rrpBeaconServer.queryFilter(requestedBeaconUpdateFilter, blockHistoryLimit * -1, currentBlock)
            );
            if (errRequestedBeaconUpdateFilter || isNil(requestedBeaconUpdateEvents)) {
              node.logger.error('failed to fetch RequestedBeaconUpdate events', {
                ...beaconIdLogOptions,
                error: errRequestedBeaconUpdateFilter,
              });
              continue;
            }

            // Fetch UpdatedBeacon events by beaconId
            const updatedBeaconFilter = rrpBeaconServer.filters.UpdatedBeacon(beaconId);
            const [errUpdatedBeaconFilter, updatedBeaconEvents] = await retryGo(() =>
              rrpBeaconServer.queryFilter(updatedBeaconFilter, blockHistoryLimit * -1, currentBlock)
            );
            if (errUpdatedBeaconFilter || isNil(updatedBeaconEvents)) {
              node.logger.error('failed to fetch UpdatedBeacon events', {
                ...beaconIdLogOptions,
                error: errUpdatedBeaconFilter,
              });
              continue;
            }

            // Match these events by requestId and unmatched events are the ones that are still waiting to be fulfilled
            const [pendingRequestedBeaconUpdateEvent] = requestedBeaconUpdateEvents.filter(
              (rbue) => !updatedBeaconEvents.some((ub) => rbue.args!['requestId'] === ub.args!['requestId'])
            );
            if (!isNil(pendingRequestedBeaconUpdateEvent)) {
              // Check if RequestedBeaconUpdate event is awaiting fulfillment by calling AirnodeRrp.requestIsAwaitingFulfillment with requestId and check if beacon value is fresh enough and skip if it is
              const [errRequestIsAwaitingFulfillment, requestIsAwaitingFulfillment] = await retryGo(() =>
                airnodeRrp.requestIsAwaitingFulfillment(pendingRequestedBeaconUpdateEvent.args!['requestId'])
              );
              if (errRequestIsAwaitingFulfillment) {
                node.logger.error('failed to check if request is awaiting fulfillment', {
                  ...beaconIdLogOptions,
                  error: errRequestIsAwaitingFulfillment,
                });
                continue;
              }
              if (requestIsAwaitingFulfillment) {
                node.logger.warn('request is awaiting fulfillment. skipping update', beaconIdLogOptions);
                continue;
              }
            }

            // **************************************************************************
            // 3.2.3.9 Fetch current gas fee data
            // **************************************************************************
            node.logger.debug('fetching gas price...', beaconIdLogOptions);

            const [gasPriceLogs, gasTarget] = await getGasPrice({
              provider,
              chainOptions: chain.options,
            });
            if (!isEmpty(gasPriceLogs)) {
              node.logger.logPending(gasPriceLogs, beaconIdLogOptions);
            }
            if (!gasTarget) {
              node.logger.error('unable to submit transactions without gas price. skipping update', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.10 Update beacon (submit requestBeaconUpdate transaction)
            // **************************************************************************
            node.logger.debug('updating beacon...', beaconIdLogOptions);

            /**
             * 1. Airnode must first call setSponsorshipStatus(rrpBeaconServer.address, true) to enable the beacon server to make requests to AirnodeRrp
             * 2. Request sponsor should then call setUpdatePermissionStatus(keeperSponsorWallet.address, true) to allow requester to update beacon
             */

            const requestSponsorWallet = node.evm.deriveSponsorWallet(airnodeHDNode, requestSponsor);
            const currentNonce = nonce;
            const [errRequestBeaconUpdate, tx] = await retryGo(() =>
              rrpBeaconServer
                .connect(keeperSponsorWallet)
                .requestBeaconUpdate(templateId, requestSponsor, requestSponsorWallet.address, encodedParameters, {
                  gasLimit: GAS_LIMIT,
                  ...gasTarget,
                  nonce: nonce++,
                })
            );
            if (errRequestBeaconUpdate) {
              node.logger.error(
                `failed to submit transaction using wallet ${keeperSponsorWallet.address} with nonce ${currentNonce}. skipping update`,
                {
                  ...beaconIdLogOptions,
                  error: errRequestBeaconUpdate,
                }
              );
              continue;
            }
            node.logger.info(`beacon update tx submitted: ${tx?.hash}`, beaconIdLogOptions);
          }
        });

        await Promise.all(keeperSponsorWalletPromises);
      });
    })
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  node.logger.info(
    `Airkeeper finished at ${node.utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`,
    baseLogOptions
  );

  const response = {
    ok: true,
    data: { message: 'Airkeeper invocation has finished' },
  };
  return { statusCode: 200, body: JSON.stringify(response) };
};
