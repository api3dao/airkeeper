import * as path from 'path';
import * as abi from '@api3/airnode-abi';
import * as utils from '@api3/airnode-utilities';
import * as promise from '@api3/promise-utils';
import { Context, ScheduledEvent, ScheduledHandler } from 'aws-lambda';
import { ethers } from 'ethers';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import { callApi } from '../api/call-api';
import { loadConfig } from '../config';
import { initializeEvmState } from '../evm';
import {
  CallApiResult,
  CheckedSubscription,
  EVMBaseState,
  GroupedSubscriptions,
  Id,
  ProviderState,
  State,
} from '../types';
import { Config, Subscription, Template } from '../validator';
import { spawn } from '../workers';

export const handler: ScheduledHandler = async (event: ScheduledEvent, context: Context): Promise<void> => {
  utils.logger.debug(`Event: ${JSON.stringify(event, null, 2)}`);
  utils.logger.debug(`Context: ${JSON.stringify(context, null, 2)}`);

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

  const startedAt = new Date();
  utils.logger.info(`Airkeeper started at ${utils.formatDateTime(startedAt)}`);

  await updateBeacon(config);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  utils.logger.info(`PSP beacon update finished at ${utils.formatDateTime(completedAt)}. Total time: ${durationMs}ms`);
};

const initializeState = (config: Config): State => {
  const { triggers, subscriptions } = config;

  const enabledSubscriptions = triggers.protoPsp.reduce((acc: Id<Subscription>[], subscriptionId) => {
    // Get subscriptions details
    const subscription = subscriptions[subscriptionId];
    if (isNil(subscription)) {
      utils.logger.warn(`SubscriptionId ${subscriptionId} not found in subscriptions`);
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
      utils.logger.warn(`SubscriptionId ${subscriptionId} does not match expected ${expectedSubscriptionId}`);
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
    utils.logger.info('No proto-PSP subscriptions to process');
  }

  const enabledSubscriptionsByTemplateId = groupBy(enabledSubscriptions, 'templateId');
  const groupedSubscriptions = Object.keys(enabledSubscriptionsByTemplateId).reduce(
    (acc: GroupedSubscriptions[], templateId) => {
      // Get template details
      const template: Template = config.templatesV1[templateId];
      if (isNil(template)) {
        utils.logger.warn(`TemplateId ${templateId} not found in templates`);
        return acc;
      }
      // Verify templateId
      const expectedTemplateId = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [template.endpointId, template.encodedParameters]
      );
      if (expectedTemplateId !== templateId) {
        utils.logger.warn(`TemplateId ${templateId} does not match expected ${expectedTemplateId}`);
        return acc;
      }

      // Get endpoint details
      const endpoint = config.endpoints[template.endpointId];
      if (isNil(endpoint)) {
        utils.logger.warn(`EndpointId ${template.endpointId} not found in endpoints`);
        return acc;
      }
      // Verify endpointId
      const expectedEndpointId = ethers.utils.keccak256(
        ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
      );
      if (expectedEndpointId !== template.endpointId) {
        utils.logger.warn(`EndpointId ${template.endpointId} does not match expected ${expectedEndpointId}`);
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
    groupedSubscriptions,
    apiValuesBySubscriptionId: {},
    providerStates: [],
  };
};

const initializeEvmStates = async (state: State): Promise<State> => {
  const { config } = state;

  const evmChains = config.chains.filter((chain) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chains must be defined in the provided config');
  }
  const evmPromises = evmChains.flatMap((chain) =>
    Object.entries(chain.providers).map(async ([providerName, chainProvider]) => {
      utils.addMetadata({ 'Chain-ID': chain.id, Provider: providerName });

      // Initialize provider specific data
      const [logs, evmState] = await initializeEvmState(chain, chainProvider.url || '');
      utils.logger.logPending(logs);
      if (isNil(evmState)) {
        utils.logger.warn('Failed to initialize EVM state');
        utils.removeMetadata(['Chain-ID', 'Provider']);
        return null;
      }

      utils.removeMetadata(['Chain-ID', 'Provider']);
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
  const {
    config: { ois, apiCredentials },
    groupedSubscriptions,
  } = state;
  const apiValuePromises = groupedSubscriptions.map(async ({ subscriptions, template, endpoint }) => {
    const apiCallParameters = abi.decode(template.encodedParameters);

    const infiniteRetries = 100_000;
    const goResult = await promise.go(() => callApi({ ois, apiCredentials }, endpoint, apiCallParameters), {
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

  callApiResults.forEach(([logs, template]) => {
    utils.addMetadata({ 'Template-ID': template.templateId });
    utils.logger.logPending(logs);
    utils.removeMetadata(['Template-ID']);
  });

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
  const { groupedSubscriptions, apiValuesBySubscriptionId, providerStates } = state;

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
      logOptions: utils.getLogOptions()!,
      type: process.env.CLOUD_PROVIDER as 'local' | 'aws',
      stage: process.env.STAGE!,
    })
  );

  const providerSponsorResults = await Promise.allSettled(providerSponsorPromises);

  providerSponsorResults.forEach((result) => {
    if (result.status === 'rejected') {
      utils.logger.error(JSON.stringify(result.reason));
    }
  });
};

const updateBeacon = async (config: Config) => {
  // =================================================================
  // STEP 1: Initialize state
  // =================================================================
  let state: State = initializeState(config);
  utils.logger.debug('Initial state created...');

  // **************************************************************************
  // STEP 2. Initialize providers
  // **************************************************************************
  state = await initializeEvmStates(state);
  utils.logger.debug('Evm states initialized...');

  // **************************************************************************
  // STEP 3: Make API calls
  // **************************************************************************
  state = await executeApiCalls(state);
  utils.logger.debug('API requests executed...');

  // **************************************************************************
  // STEP 4. Initiate transactions for each provider, sponsor wallet pair
  // **************************************************************************
  await submitTransactions(state);
  utils.logger.debug('Transactions submitted...');

  return state;
};
