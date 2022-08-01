import * as abi from '@api3/airnode-abi';
import * as utils from '@api3/airnode-utilities';
import * as promise from '@api3/promise-utils';
import { ethers } from 'ethers';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import { spawn } from '../workers';
import { initializeEvmState } from '../evm';
import { callApi } from '../api/call-api';
import { loadAirkeeperConfig, loadAirnodeConfig, mergeConfigs } from '../config';
import { buildLogOptions } from '../logger';
import {
  CallApiResult,
  CheckedSubscription,
  Config,
  EVMBaseState,
  GroupedSubscriptions,
  Id,
  ProviderState,
  State,
} from '../types';
import { Subscription } from '../validator';

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

  const airnodeConfig = promise.goSync(loadAirnodeConfig);
  if (!airnodeConfig.success) {
    utils.logger.error(airnodeConfig.error.message);
    throw airnodeConfig.error;
  }
  // This file will be merged with config.json from above
  const airkeeperConfig = promise.goSync(loadAirkeeperConfig);
  if (!airkeeperConfig.success) {
    utils.logger.error(airkeeperConfig.error.message);
    throw airkeeperConfig.error;
  }
  const config = mergeConfigs(airnodeConfig.data, airkeeperConfig.data);

  const state = await updateBeacon(config);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  utils.logger.info(
    `PSP beacon update finished at ${utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`,
    state.baseLogOptions
  );

  const response = {
    ok: true,
    data: { message: 'PSP beacon update execution has finished' },
  };
  return { statusCode: 200, body: JSON.stringify(response) };
};

const initializeState = (config: Config): State => {
  const { triggers, subscriptions } = config;

  const baseLogOptions = utils.buildBaseOptions(config, {
    coordinatorId: utils.randomHexString(8),
  });

  const enabledSubscriptions = triggers.protoPsp.reduce((acc: Id<Subscription>[], subscriptionId) => {
    // Get subscriptions details
    const subscription = subscriptions[subscriptionId];
    if (isNil(subscription)) {
      utils.logger.warn(`SubscriptionId ${subscriptionId} not found in subscriptions`, baseLogOptions);
      return acc;
    }
    // Verify subscriptionId
    const expectedSubscriptionId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
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
      utils.logger.warn(
        `SubscriptionId ${subscriptionId} does not match expected ${expectedSubscriptionId}`,
        baseLogOptions
      );
      return acc;
    }

    return [
      ...acc,
      {
        ...subscription,
        id: subscriptionId,
      },
    ];
  }, []);

  if (isEmpty(enabledSubscriptions)) {
    utils.logger.info('No proto-PSP subscriptions to process', baseLogOptions);
  }

  const enabledSubscriptionsByTemplateId = groupBy(enabledSubscriptions, 'templateId');
  const groupedSubscriptions = Object.keys(enabledSubscriptionsByTemplateId).reduce(
    (acc: GroupedSubscriptions[], templateId) => {
      // Get template details
      const template = config.templatesV1[templateId];
      if (isNil(template)) {
        utils.logger.warn(`TemplateId ${templateId} not found in templates`, baseLogOptions);
        return acc;
      }
      // Verify templateId
      const expectedTemplateId = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [template.endpointId, template.encodedParameters]
      );
      if (expectedTemplateId !== templateId) {
        utils.logger.warn(`TemplateId ${templateId} does not match expected ${expectedTemplateId}`, baseLogOptions);
        return acc;
      }

      // Get endpoint details
      const endpoint = config.endpoints[template.endpointId];
      if (isNil(endpoint)) {
        utils.logger.warn(`EndpointId ${template.endpointId} not found in endpoints`, baseLogOptions);
        return acc;
      }
      // Verify endpointId
      const expectedEndpointId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
      );
      if (expectedEndpointId !== template.endpointId) {
        utils.logger.warn(
          `EndpointId ${template.endpointId} does not match expected ${expectedEndpointId}`,
          baseLogOptions
        );
        return acc;
      }

      return [
        ...acc,
        {
          subscriptions: enabledSubscriptionsByTemplateId[templateId],
          template: { ...template, id: templateId },
          endpoint: { ...endpoint, id: template.endpointId },
        },
      ];
    },
    []
  );
  return {
    config,
    baseLogOptions,
    groupedSubscriptions,
    apiValuesBySubscriptionId: {},
    providerStates: [],
  };
};

const initializeEvmStates = async (state: State): Promise<State> => {
  const { config, baseLogOptions } = state;

  const evmChains = config.chains.filter((chain) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chains must be defined in the provided config');
  }
  const evmPromises = evmChains.flatMap((chain) =>
    Object.entries(chain.providers).map(async ([providerName, chainProvider]) => {
      const evmLogOptions = buildLogOptions('meta', { chainId: chain.id, providerName }, baseLogOptions);

      // Initialize provider specific data
      const [logs, evmState] = await initializeEvmState(chain, chainProvider.url || '');
      utils.logger.logPending(logs, evmLogOptions);
      if (isNil(evmState)) {
        utils.logger.warn('Failed to initialize EVM state', evmLogOptions);
        return null;
      }

      return {
        chainId: chain.id,
        providerName,
        providerUrl: chainProvider.url,
        chainConfig: chain,
        ...evmState,
      };
    })
  );

  const evmStates = await Promise.all(evmPromises);
  const validEvmStates = evmStates.filter((ps) => !isNil(ps)) as ProviderState<EVMBaseState>[];

  return { ...state, providerStates: validEvmStates };
};

const executeApiCalls = async (state: State): Promise<State> => {
  const { config, baseLogOptions, groupedSubscriptions } = state;
  const apiValuePromises = groupedSubscriptions.map(async ({ subscriptions, template, endpoint }) => {
    const apiCallParameters = abi.decode(template.encodedParameters);

    const infiniteRetries = 100_000;
    const goResult = await promise.go(() => callApi(config, endpoint, apiCallParameters), {
      attemptTimeoutMs: 10_000,
      retries: infiniteRetries,
      totalTimeoutMs: 40_000,
      delay: {
        type: 'random',
        minDelayMs: 200,
        maxDelayMs: 2000,
      },
    });

    if (goResult.success) {
      const [logs, data] = goResult.data;
      return [logs, { templateId: template.id, apiValue: data, subscriptions }] as CallApiResult;
    } else {
      return [
        [utils.logger.pend('DEBUG', `Retrying API call for templateId ${template.id}: ${goResult.error.message}`)],
        { templateId: template.id, apiValue: null, subscriptions },
      ] as CallApiResult;
    }
  });

  const callApiResults = await Promise.all(apiValuePromises);
  const successfulCalls = callApiResults.filter((call) => call[1].apiValue !== null);

  const logs = callApiResults.flatMap((call) => call[0]);
  utils.logger.logPending(logs, baseLogOptions);

  const apiValuesBySubscriptionId = successfulCalls.reduce(
    (acc: { [subscriptionId: string]: ethers.BigNumber }, result) => {
      const [_logs, data] = result;

      return {
        ...acc,
        ...data.subscriptions.reduce((acc2, { id }) => {
          return { ...acc2, [id]: data.apiValue };
        }, {}),
      };
    },
    {}
  );

  return { ...state, apiValuesBySubscriptionId };
};

const submitTransactions = async (state: State) => {
  const { baseLogOptions, groupedSubscriptions, apiValuesBySubscriptionId, providerStates } = state;

  const subscriptions = groupedSubscriptions.flatMap((s) => s.subscriptions);

  const providerSponsorSubscriptionsArray = providerStates.reduce(
    (
      acc: {
        sponsorAddress: string;
        providerState: ProviderState<EVMBaseState>;
        subscriptions: Id<CheckedSubscription>[];
      }[],
      providerState
    ) => {
      // Filter subscription by chainId, double-check that subscription has an associated API value and add
      // it to the subscription object
      const chainSubscriptions = subscriptions.reduce(
        (acc: (Id<Subscription> & { apiValue: ethers.BigNumber })[], subscription) => {
          if (subscription.chainId === providerState.chainId && apiValuesBySubscriptionId[subscription.id])
            return [...acc, { ...subscription, apiValue: apiValuesBySubscriptionId[subscription.id] }];
          return acc;
        },
        []
      );

      // Group filtered subscriptions by sponsorAddress
      const subscriptionsBySponsor = groupBy(chainSubscriptions, 'sponsor');

      // Collect subscriptions for each provider + sponsor pair
      const subscriptionGroup = Object.entries(subscriptionsBySponsor).map(([sponsorAddress, subscriptions]) => ({
        sponsorAddress: sponsorAddress,
        providerState,
        subscriptions,
      }));

      return [...acc, ...subscriptionGroup];
    },
    []
  );

  const providerSponsorPromises = providerSponsorSubscriptionsArray.map(async (providerSponsorSubscriptions) =>
    spawn({
      providerSponsorSubscriptions,
      baseLogOptions: baseLogOptions,
      type: process.env.CLOUD_PROVIDER as 'local' | 'aws',
      stage: process.env.STAGE!,
    })
  );

  const providerSponsorResults = await Promise.allSettled(providerSponsorPromises);

  providerSponsorResults.forEach((result) => {
    if (result.status === 'rejected') {
      utils.logger.error(JSON.stringify(result.reason), baseLogOptions);
    }
  });
};

const updateBeacon = async (config: Config) => {
  // =================================================================
  // STEP 1: Initialize state
  // =================================================================
  let state: State = initializeState(config);
  utils.logger.debug('Initial state created...', state.baseLogOptions);

  // **************************************************************************
  // STEP 2. Initialize providers
  // **************************************************************************
  state = await initializeEvmStates(state);
  utils.logger.debug('Evm states initialized...', state.baseLogOptions);

  // **************************************************************************
  // STEP 3: Make API calls
  // **************************************************************************
  state = await executeApiCalls(state);
  utils.logger.debug('API requests executed...', state.baseLogOptions);

  // **************************************************************************
  // STEP 4. Initiate transactions for each provider, sponsor wallet pair
  // **************************************************************************
  await submitTransactions(state);
  utils.logger.debug('Transactions submitted...', state.baseLogOptions);

  return state;
};
