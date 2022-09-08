import * as path from 'path';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as protocol from '@api3/airnode-protocol';
import * as utils from '@api3/airnode-utilities';
import * as promise from '@api3/promise-utils';
import { Context, ScheduledEvent, ScheduledHandler } from 'aws-lambda';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import map from 'lodash/map';
import { callApi } from '../api/call-api';
import { loadConfig } from '../config';
import { BLOCK_COUNT_HISTORY_LIMIT, GAS_LIMIT, RETRIES, TIMEOUT_MS } from '../constants';
import { LogsAndApiValuesByBeaconId } from '../types';
import { ChainConfig, Config } from '../validator';
import { shortenAddress } from '../wallet';

type ApiValueByBeaconId = {
  [beaconId: string]: ethers.BigNumber | null;
};

export const handler: ScheduledHandler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  utils.logger.debug(`Event: ${JSON.stringify(event, null, 2)}`);
  utils.logger.debug(`Context: ${JSON.stringify(context, null, 2)}`);

  const startedAt = new Date();

  // **************************************************************************
  // 1. Load config
  // **************************************************************************
  const goConfig: promise.GoResult<Config> = promise.goSync(() =>
    loadConfig(path.join(__dirname, '..', '..', 'config', 'airkeeper.json'), process.env)
  );
  if (!goConfig.success) {
    utils.logger.error(goConfig.error.message);
    throw goConfig.error;
  }
  const { data: config } = goConfig;

  const coordinatorId = utils.randomHexString(16);
  utils.setLogOptions({
    format: config.nodeSettings.logFormat,
    level: config.nodeSettings.logLevel,
    meta: { 'Coordinator-ID': coordinatorId },
  });

  utils.logger.info(`Airkeeper started at ${utils.formatDateTime(startedAt)}`);

  const { airnodeAddress, airnodeXpub, chains, nodeSettings, triggers, endpoints, ois, apiCredentials } = config;

  const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(nodeSettings.airnodeWalletMnemonic);
  const derivedAirnodeAddress = (
    airnodeXpub
      ? ethers.utils.HDNode.fromExtendedKey(airnodeXpub).derivePath('0/0')
      : airnodeHDNode.derivePath(ethers.utils.defaultPath)
  ).address;

  if (airnodeAddress && airnodeAddress !== derivedAirnodeAddress) {
    throw new Error(`xpub does not belong to Airnode: ${derivedAirnodeAddress}`);
  }

  // **************************************************************************
  // 2. Read and cache API values
  // **************************************************************************
  utils.logger.debug('making API requests...');

  const apiValuePromises = triggers.rrpBeaconServerKeeperJobs.map(({ templateId, templateParameters, endpointId }) =>
    promise.go(
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
        const expectedTemplateId = node.evm.templates.getExpectedTemplateIdV0({
          airnodeAddress: derivedAirnodeAddress,
          endpointId,
          encodedParameters,
        });
        if (expectedTemplateId !== templateId) {
          const message = `templateId '${templateId}' does not match expected templateId '${expectedTemplateId}'`;
          const log = utils.logger.pend('ERROR', message);
          return Promise.resolve([[log], { [beaconId]: null }] as node.LogsData<ApiValueByBeaconId>);
        }

        const apiCallParameters = templateParameters.reduce((acc, p) => ({ ...acc, [p.name]: p.value }), {});

        const [logs, data] = await callApi({ ois, apiCredentials }, endpoints[endpointId], apiCallParameters);

        return [logs, { [beaconId]: data }] as node.LogsData<ApiValueByBeaconId>;
      },
      { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
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
  Object.keys(logsAndApiValuesByBeaconId).forEach((beaconId) => {
    const logOptions = utils.getLogOptions();
    return utils.logger.logPending(logsAndApiValuesByBeaconId[beaconId].logs, {
      ...logOptions,
      meta: {
        ...logOptions!.meta,
        'Beacon-ID': beaconId,
      },
    });
  });

  // **************************************************************************
  // 3. Process chain providers in parallel
  // **************************************************************************
  utils.logger.debug('processing chain providers...');

  const evmChains = chains.filter((chain: ChainConfig) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chain(s) must be defined in the provided config');
  }
  const providerPromises = flatMap(
    evmChains.map((chain: ChainConfig) => {
      return map(chain.providers, async (chainProvider, providerName) => {
        utils.addMetadata({ 'Chain-ID': chain.id, Provider: providerName });

        // **************************************************************************
        // 3.1 Initialize provider specific data
        // **************************************************************************
        utils.logger.debug('initializing...');

        const blockHistoryLimit = chain.blockHistoryLimit || BLOCK_COUNT_HISTORY_LIMIT;
        const chainProviderUrl = chainProvider.url || '';
        const provider = node.evm.buildEVMProvider(chainProviderUrl, chain.id);

        const airnodeRrp = protocol.AirnodeRrpV0Factory.connect(chain.contracts.AirnodeRrp, provider);

        const rrpBeaconServer = protocol.RrpBeaconServerV0Factory.connect(chain.contracts.RrpBeaconServer!, provider);

        // Fetch current block number from chain via provider
        const currentBlock = await promise.go(() => provider.getBlockNumber(), {
          attemptTimeoutMs: TIMEOUT_MS,
          retries: RETRIES,
        });
        if (!currentBlock.success) {
          utils.logger.error('failed to fetch the blockNumber', currentBlock.error);
          return;
        }

        // **************************************************************************
        // 3.2 Process each keeperSponsor address in parallel
        // **************************************************************************
        utils.logger.debug('processing keeperSponsor addresses...');

        // Group rrpBeaconServerKeeperJobs by keeperSponsor
        const rrpBeaconServerKeeperJobsByKeeperSponsor = groupBy(triggers.rrpBeaconServerKeeperJobs, 'keeperSponsor');
        const keeperSponsorAddresses = Object.keys(rrpBeaconServerKeeperJobsByKeeperSponsor);

        const keeperSponsorWalletPromises = keeperSponsorAddresses.map(async (keeperSponsor) => {
          // **************************************************************************
          // 3.2.1 Derive keeperSponsorWallet address
          // **************************************************************************
          utils.logger.debug('deriving keeperSponsorWallet...');

          const keeperSponsorWallet = node.evm
            .deriveSponsorWalletFromMnemonic(config.nodeSettings.airnodeWalletMnemonic, keeperSponsor, '12345')
            .connect(provider);

          utils.addMetadata({ 'Sponsor-Wallet': shortenAddress(keeperSponsorWallet.address) });

          // **************************************************************************
          // 3.2.2 Fetch keeperSponsorWallet transaction count
          // **************************************************************************
          utils.logger.debug('fetching transaction count...');

          const keeperSponsorWalletTransactionCount = await promise.go(
            () => provider.getTransactionCount(keeperSponsorWallet.address, currentBlock.data),
            { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
          );
          if (!keeperSponsorWalletTransactionCount.success) {
            utils.logger.error(
              'failed to fetch the keeperSponsorWallet transaction count',
              keeperSponsorWalletTransactionCount.error
            );
            return;
          }
          let nextNonce = keeperSponsorWalletTransactionCount.data;

          // **************************************************************************
          // 3.2.3 Process each rrpBeaconServerKeeperJob in serial to keep nonces in order
          // **************************************************************************
          utils.logger.debug('processing rrpBeaconServerKeeperJobs...');

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
            utils.logger.debug('deriving beaconId...');

            const encodedParameters = abi.encode(templateParameters);
            const beaconId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [templateId, encodedParameters]);

            const logOptions = utils.getLogOptions();
            const beaconIdLogOptions: utils.LogOptions = {
              ...logOptions!,
              meta: {
                ...logOptions!.meta,
                'Beacon-ID': beaconId,
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
                null,
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
            const beaconResponse = await promise.go(() => rrpBeaconServer.connect(voidSigner).readBeacon(beaconId), {
              attemptTimeoutMs: TIMEOUT_MS,
              retries: RETRIES,
            });
            if (!beaconResponse.success) {
              utils.logger.error(
                `failed to read value for beaconId: ${beaconId}`,
                beaconResponse.error,
                beaconIdLogOptions
              );
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
            const requestedBeaconUpdateEvents = await promise.go(
              () => rrpBeaconServer.queryFilter(requestedBeaconUpdateFilter, blockHistoryLimit * -1, currentBlock.data),
              { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
            );
            if (!requestedBeaconUpdateEvents.success) {
              utils.logger.error(
                'failed to fetch RequestedBeaconUpdate events',
                requestedBeaconUpdateEvents.error,
                beaconIdLogOptions
              );
              continue;
            }

            // Fetch UpdatedBeacon events by beaconId
            const updatedBeaconFilter = rrpBeaconServer.filters.UpdatedBeacon(beaconId);
            const updatedBeaconEvents = await promise.go(
              () => rrpBeaconServer.queryFilter(updatedBeaconFilter, blockHistoryLimit * -1, currentBlock.data),
              { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
            );
            if (!updatedBeaconEvents.success) {
              utils.logger.error('failed to fetch UpdatedBeacon events', updatedBeaconEvents.error, beaconIdLogOptions);
              continue;
            }

            // Match these events by requestId and unmatched events are the ones that are still waiting to be fulfilled
            const [pendingRequestedBeaconUpdateEvent] = requestedBeaconUpdateEvents.data.filter(
              (rbue) => !updatedBeaconEvents.data.some((ub) => rbue.args!['requestId'] === ub.args!['requestId'])
            );
            if (!isNil(pendingRequestedBeaconUpdateEvent)) {
              // Check if RequestedBeaconUpdate event is awaiting fulfillment by calling AirnodeRrp.requestIsAwaitingFulfillment with requestId and check if beacon value is fresh enough and skip if it is
              const requestIsAwaitingFulfillment = await promise.go(
                () => airnodeRrp.requestIsAwaitingFulfillment(pendingRequestedBeaconUpdateEvent.args!['requestId']),
                { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
              );
              if (!requestIsAwaitingFulfillment.success) {
                utils.logger.error(
                  'failed to check if request is awaiting fulfillment',
                  requestIsAwaitingFulfillment.error,
                  beaconIdLogOptions
                );
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

            const [gasPriceLogs, gasTarget] = await utils.getGasPrice(provider, chain.options);
            if (!isEmpty(gasPriceLogs)) {
              utils.logger.logPending(gasPriceLogs);
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
            const tx = await promise.go(
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
              { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
            );
            if (!tx.success) {
              utils.logger.error(
                `failed to submit transaction using wallet ${keeperSponsorWallet.address} with nonce ${nonce}. skipping update`,
                tx.error,
                beaconIdLogOptions
              );
              continue;
            }
            utils.logger.info(`beacon update tx submitted: ${tx.data.hash}`, beaconIdLogOptions);
          }

          utils.removeMetadata(['Sponsor-Wallet']);
        });

        await Promise.all(keeperSponsorWalletPromises);
        utils.removeMetadata(['Chain-ID', 'Provider']);
      });
    })
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  utils.logger.info(`Airkeeper finished at ${utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`);
};
