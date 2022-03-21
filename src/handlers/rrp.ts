import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as protocol from '@api3/airnode-protocol';
import * as utils from '@api3/airnode-utilities';
import { go, goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import { callApi } from '../api/call-api';
import { BLOCK_COUNT_HISTORY_LIMIT, GAS_LIMIT, TIMEOUT_MS } from '../constants';
import { loadAirnodeConfig, mergeConfigs, loadAirkeeperConfig } from '../config';
import { ChainConfig, LogsAndApiValuesByBeaconId } from '../types';
import { shortenAddress } from '../wallet';

type ApiValueByBeaconId = {
  [beaconId: string]: ethers.BigNumber | null;
};

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  const airnodeConfig = goSync(loadAirnodeConfig);
  if (!airnodeConfig.success) {
    utils.logger.error(airnodeConfig.error.message);
    throw airnodeConfig.error;
  }
  // This file will be merged with config.json from above
  const airkeeperConfig = goSync(loadAirkeeperConfig);
  if (!airkeeperConfig.success) {
    utils.logger.error(airkeeperConfig.error.message);
    throw airkeeperConfig.error;
  }

  const baseLogOptions = utils.buildBaseOptions(airnodeConfig.data, {
    coordinatorId: utils.randomHexString(8),
  });
  utils.logger.info(`Airkeeper started at ${utils.formatDateTime(startedAt)}`, baseLogOptions);

  const config = mergeConfigs(airnodeConfig.data, airkeeperConfig.data);
  const { chains, triggers, endpoints } = config;

  const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic);
  const airnodeAddress = (
    airkeeperConfig.data.airnodeXpub
      ? ethers.utils.HDNode.fromExtendedKey(airkeeperConfig.data.airnodeXpub).derivePath('0/0')
      : airnodeHDNode.derivePath(ethers.utils.defaultPath)
  ).address;

  if (airkeeperConfig.data.airnodeAddress && airkeeperConfig.data.airnodeAddress !== airnodeAddress) {
    throw new Error(`xpub does not belong to Airnode: ${airnodeAddress}`);
  }

  // **************************************************************************
  // 2. Read and cache API values
  // **************************************************************************
  utils.logger.debug('making API requests...', baseLogOptions);

  const apiValuePromises = triggers.rrpBeaconServerKeeperJobs.map(({ templateId, templateParameters, endpointId }) =>
    go(
      async () => {
        const { oisTitle, endpointName } = endpoints[endpointId];

        const encodedParameters = abi.encode(templateParameters);
        const beaconId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [templateId, encodedParameters]);

        // Verify endpointId
        const expectedEndpointId = ethers.utils.keccak256(
          ethers.utils.defaultAbiCoder.encode(['string', 'string'], [oisTitle, endpointName])
        );
        if (expectedEndpointId !== endpointId) {
          const message = `endpointId '${endpointId}' does not match expected endpointId '${expectedEndpointId}'`;
          const log = utils.logger.pend('ERROR', message);
          return Promise.resolve([[log], { [beaconId]: null }] as node.LogsData<ApiValueByBeaconId>);
        }

        // Verify templateId
        const expectedTemplateId = node.evm.templates.getExpectedTemplateId({
          airnodeAddress,
          endpointId: expectedEndpointId,
          encodedParameters,
          // id: templateId, // TODO: is this needed? Airnode type has chaned to ApiCallTemplateWithoutId
        });
        if (expectedTemplateId !== templateId) {
          const message = `templateId '${templateId}' does not match expected templateId '${expectedTemplateId}'`;
          const log = utils.logger.pend('ERROR', message);
          return Promise.resolve([[log], { [beaconId]: null }] as node.LogsData<ApiValueByBeaconId>);
        }

        const apiCallParameters = templateParameters.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {});

        const [logs, data] = await callApi(config, {
          id: templateId,
          airnodeAddress,
          endpointId,
          endpointName,
          oisTitle,
          parameters: apiCallParameters,
        });

        return [logs, { [beaconId]: data }] as node.LogsData<ApiValueByBeaconId>;
      },
      { timeoutMs: TIMEOUT_MS, retries: 1 }
    )
  );
  const responses = await Promise.all(apiValuePromises);

  // Group logs and API values by beaconId
  const logsAndApiValuesByBeaconId: LogsAndApiValuesByBeaconId = responses.reduce((acc, logsData) => {
    if (!logsData.success || !logsData.data) {
      return acc;
    }
    const [logs, data] = logsData.data;
    const [beaconId] = Object.keys(data);
    return { ...acc, ...{ [beaconId]: { logs, apiValue: data[beaconId] } } };
  }, {});

  // Print pending logs
  Object.keys(logsAndApiValuesByBeaconId).forEach((beaconId) =>
    utils.logger.logPending(logsAndApiValuesByBeaconId[beaconId].logs, {
      ...baseLogOptions,
      additional: { beaconId },
    })
  );

  // **************************************************************************
  // 3. Process chain providers in parallel
  // **************************************************************************
  utils.logger.debug('processing chain providers...', baseLogOptions);

  const evmChains = chains.filter((chain: ChainConfig) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: ChainConfig) => {
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
        utils.logger.debug('initializing...', providerLogOptions);

        const blockHistoryLimit = chain.blockHistoryLimit || BLOCK_COUNT_HISTORY_LIMIT;
        const chainProviderUrl = chainProvider.url || '';
        const provider = node.evm.buildEVMProvider(chainProviderUrl, chain.id);

        const airnodeRrp = protocol.AirnodeRrpFactory.connect(chain.contracts.AirnodeRrp, provider);

        const rrpBeaconServer = protocol.RrpBeaconServerFactory.connect(chain.contracts.RrpBeaconServer!, provider);

        // Fetch current block number from chain via provider
        const currentBlock = await go(() => provider.getBlockNumber(), {
          timeoutMs: TIMEOUT_MS,
          retries: 1,
        });
        if (!currentBlock.success) {
          utils.logger.error('failed to fetch the blockNumber', {
            ...providerLogOptions,
            error: currentBlock.error,
          });
          return;
        }

        // **************************************************************************
        // 3.2 Process each keeperSponsor address in parallel
        // **************************************************************************
        utils.logger.debug('processing keeperSponsor addresses...', providerLogOptions);

        // Group rrpBeaconServerKeeperJobs by keeperSponsor
        const rrpBeaconServerKeeperJobsByKeeperSponsor = groupBy(triggers.rrpBeaconServerKeeperJobs, 'keeperSponsor');
        const keeperSponsorAddresses = Object.keys(rrpBeaconServerKeeperJobsByKeeperSponsor);

        const keeperSponsorWalletPromises = keeperSponsorAddresses.map(async (keeperSponsor) => {
          // **************************************************************************
          // 3.2.1 Derive keeperSponsorWallet address
          // **************************************************************************
          utils.logger.debug('deriving keeperSponsorWallet...', providerLogOptions);

          const keeperSponsorWallet = node.evm
            .deriveSponsorWalletFromMnemonic(config.nodeSettings.airnodeWalletMnemonic, keeperSponsor, '12345')
            .connect(provider);

          const keeperSponsorWalletLogOptions = {
            ...providerLogOptions,
            additional: {
              keeperSponsorWallet: shortenAddress(keeperSponsorWallet.address),
            },
          };

          // **************************************************************************
          // 3.2.2 Fetch keeperSponsorWallet transaction count
          // **************************************************************************
          utils.logger.debug('fetching transaction count...', keeperSponsorWalletLogOptions);

          const keeperSponsorWalletTransactionCount = await go(
            () => provider.getTransactionCount(keeperSponsorWallet.address, currentBlock.data),
            { timeoutMs: TIMEOUT_MS, retries: 1 }
          );
          if (!keeperSponsorWalletTransactionCount.success) {
            utils.logger.error('failed to fetch the keeperSponsorWallet transaction count', {
              ...keeperSponsorWalletLogOptions,
              error: keeperSponsorWalletTransactionCount.error,
            });
            return;
          }
          let nextNonce = keeperSponsorWalletTransactionCount.data;

          // **************************************************************************
          // 3.2.3 Process each rrpBeaconServerKeeperJob in serial to keep nonces in order
          // **************************************************************************
          utils.logger.debug('processing rrpBeaconServerKeeperJobs...', keeperSponsorWalletLogOptions);

          const rrpBeaconServerKeeperJobs = rrpBeaconServerKeeperJobsByKeeperSponsor[keeperSponsor];
          for (const {
            chainIds,
            templateId,
            templateParameters,
            deviationPercentage,
            requestSponsor,
          } of rrpBeaconServerKeeperJobs) {
            // **************************************************************************
            // 3.2.3.1 Derive beaconId
            // **************************************************************************
            utils.logger.debug('deriving beaconId...', keeperSponsorWalletLogOptions);

            const encodedParameters = abi.encode(templateParameters);
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
            utils.logger.debug('verifying if beacon must be updated for current chain...', beaconIdLogOptions);

            // If chainIds is not defined, beacon must be updated to keep backward compatibility
            if (chainIds && !chainIds.includes(chain.id)) {
              utils.logger.debug('skipping beaconId as it is not for current chain', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.3 Read API value from cache
            // **************************************************************************
            utils.logger.debug('looking for API value...', beaconIdLogOptions);

            const apiValue = logsAndApiValuesByBeaconId[beaconId].apiValue;
            if (isNil(apiValue)) {
              utils.logger.warn('API value is missing. skipping update', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.4 Verify deviationPercentage is between 0 and 100 and has only 2 decimal places
            // **************************************************************************
            utils.logger.debug('verifying deviationPercentage...', beaconIdLogOptions);

            if (
              isNaN(Number(deviationPercentage)) ||
              Number(deviationPercentage) <= 0 ||
              Number(deviationPercentage) > 100 ||
              !Number.isInteger(Number(deviationPercentage) * 100) // Only 2 decimal places is allowed
            ) {
              utils.logger.error(
                `deviationPercentage '${deviationPercentage}' must be a number larger than 0 and less then or equal to 100 with no more than 2 decimal places`,
                beaconIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // 3.2.3.5 Read beacon
            // **************************************************************************
            utils.logger.debug('reading beacon value...', beaconIdLogOptions);

            // address(0) is considered whitelisted
            const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
            const beaconResponse = await go(() => rrpBeaconServer.connect(voidSigner).readBeacon(beaconId), {
              timeoutMs: TIMEOUT_MS,
              retries: 1,
            });
            if (!beaconResponse.success) {
              utils.logger.error(`failed to read value for beaconId: ${beaconId}`, {
                ...beaconIdLogOptions,
                error: beaconResponse.error,
              });
              continue;
            }
            utils.logger.info(`beacon server value: ${beaconResponse.data.value.toString()}`, beaconIdLogOptions);

            // **************************************************************************
            // 3.2.3.6 Calculate deviation
            // **************************************************************************
            utils.logger.debug('calculating deviation...', beaconIdLogOptions);

            let beaconValue = beaconResponse.data.value;
            const delta = beaconValue.sub(apiValue!).abs();
            if (delta.eq(0)) {
              utils.logger.warn('beacon is up-to-date. skipping update', beaconIdLogOptions);
              continue;
            }
            beaconValue = beaconResponse.data.value.isZero() ? ethers.constants.One : beaconResponse.data.value;
            const basisPoints = ethers.utils.parseUnits('1', 16);
            const deviation = delta.mul(basisPoints).mul(100).div(beaconValue);
            utils.logger.info(`deviation (%): ${ethers.utils.formatUnits(deviation, 16)}`, beaconIdLogOptions);

            // **************************************************************************
            // 3.2.3.7 Check if deviation is within the threshold
            // **************************************************************************
            utils.logger.debug('checking deviation...', beaconIdLogOptions);

            const percentageThreshold = basisPoints.mul(
              Number(deviationPercentage) * 100 // support for percentages up to 2 decimal places
            );
            if (deviation.lte(percentageThreshold.div(100))) {
              utils.logger.warn(
                'delta between beacon value and API value is within threshold. skipping update',
                beaconIdLogOptions
              );
              continue;
            }

            // **************************************************************************
            // 3.2.3.8 Fetch previous events to determine if previous update tx is pending
            // **************************************************************************
            utils.logger.debug('checking previous txs...', beaconIdLogOptions);

            // Check to prevent sending the same request for beacon update more than once
            // by checking if a RequestedBeaconUpdate event was emitted but no matching
            // UpdatedBeacon event was emitted.

            // Fetch RequestedBeaconUpdate events by beaconId, sponsor and sponsorWallet
            const requestedBeaconUpdateFilter = rrpBeaconServer.filters.RequestedBeaconUpdate(
              beaconId,
              requestSponsor,
              keeperSponsorWallet.address
            );
            const requestedBeaconUpdateEvents = await go(
              () => rrpBeaconServer.queryFilter(requestedBeaconUpdateFilter, blockHistoryLimit * -1, currentBlock.data),
              { timeoutMs: TIMEOUT_MS, retries: 1 }
            );
            if (!requestedBeaconUpdateEvents.success) {
              utils.logger.error('failed to fetch RequestedBeaconUpdate events', {
                ...beaconIdLogOptions,
                error: requestedBeaconUpdateEvents.error,
              });
              continue;
            }

            // Fetch UpdatedBeacon events by beaconId
            const updatedBeaconFilter = rrpBeaconServer.filters.UpdatedBeacon(beaconId);
            const updatedBeaconEvents = await go(
              () => rrpBeaconServer.queryFilter(updatedBeaconFilter, blockHistoryLimit * -1, currentBlock.data),
              { timeoutMs: TIMEOUT_MS, retries: 1 }
            );
            if (!updatedBeaconEvents.success) {
              utils.logger.error('failed to fetch UpdatedBeacon events', {
                ...beaconIdLogOptions,
                error: updatedBeaconEvents.error,
              });
              continue;
            }

            // Match these events by requestId and unmatched events are the ones that are still waiting to be fulfilled
            const [pendingRequestedBeaconUpdateEvent] = requestedBeaconUpdateEvents.data.filter(
              (rbue) => !updatedBeaconEvents.data.some((ub) => rbue.args!['requestId'] === ub.args!['requestId'])
            );
            if (!isNil(pendingRequestedBeaconUpdateEvent)) {
              // Check if RequestedBeaconUpdate event is awaiting fulfillment by calling AirnodeRrp.requestIsAwaitingFulfillment with requestId and check if beacon value is fresh enough and skip if it is
              const requestIsAwaitingFulfillment = await go(
                () => airnodeRrp.requestIsAwaitingFulfillment(pendingRequestedBeaconUpdateEvent.args!['requestId']),
                { timeoutMs: TIMEOUT_MS, retries: 1 }
              );
              if (!requestIsAwaitingFulfillment.success) {
                utils.logger.error('failed to check if request is awaiting fulfillment', {
                  ...beaconIdLogOptions,
                  error: requestIsAwaitingFulfillment.error,
                });
                continue;
              }
              if (requestIsAwaitingFulfillment.data) {
                utils.logger.warn('request is awaiting fulfillment. skipping update', beaconIdLogOptions);
                continue;
              }
            }

            // **************************************************************************
            // 3.2.3.9 Fetch current gas fee data
            // **************************************************************************
            utils.logger.debug('fetching gas price...', beaconIdLogOptions);

            const [gasPriceLogs, gasTarget] = await utils.getGasPrice({
              provider,
              chainOptions: chain.options,
            });
            if (!isEmpty(gasPriceLogs)) {
              utils.logger.logPending(gasPriceLogs, beaconIdLogOptions);
            }
            if (!gasTarget) {
              utils.logger.warn('failed to fetch gas price. Skipping update...', beaconIdLogOptions);
              continue;
            }

            // **************************************************************************
            // 3.2.3.10 Update beacon (submit requestBeaconUpdate transaction)
            // **************************************************************************
            utils.logger.debug('updating beacon...', beaconIdLogOptions);

            /**
             * 1. Airnode must first call setSponsorshipStatus(rrpBeaconServer.address, true) to enable the beacon server to make requests to AirnodeRrp
             * 2. Request sponsor should then call setUpdatePermissionStatus(keeperSponsorWallet.address, true) to allow requester to update beacon
             */

            const requestSponsorWallet = node.evm.deriveSponsorWallet(airnodeHDNode, requestSponsor);
            const nonce = nextNonce++;
            const overrides = {
              gasLimit: GAS_LIMIT,
              ...gasTarget,
              nonce,
            };
            const tx = await go(
              () =>
                rrpBeaconServer
                  .connect(keeperSponsorWallet)
                  .requestBeaconUpdate(
                    templateId,
                    requestSponsor,
                    requestSponsorWallet.address,
                    encodedParameters,
                    overrides
                  ),
              { timeoutMs: TIMEOUT_MS, retries: 1 }
            );
            if (!tx.success) {
              utils.logger.error(
                `failed to submit transaction using wallet ${keeperSponsorWallet.address} with nonce ${nonce}. skipping update`,
                {
                  ...beaconIdLogOptions,
                  error: tx.error,
                }
              );
              continue;
            }
            utils.logger.info(`beacon update tx submitted: ${tx.data.hash}`, beaconIdLogOptions);
          }
        });

        await Promise.all(keeperSponsorWalletPromises);
      });
    })
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  utils.logger.info(
    `Airkeeper finished at ${utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`,
    baseLogOptions
  );

  const response = {
    ok: true,
    data: { message: 'Airkeeper invocation has finished' },
  };
  return { statusCode: 200, body: JSON.stringify(response) };
};
