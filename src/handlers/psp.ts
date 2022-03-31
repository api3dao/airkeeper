import AWS from 'aws-sdk';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go, goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import { handler as processSubscriptionsHandler } from './process-subscriptions';
import { callApi } from '../api/call-api';
import { loadAirkeeperConfig, loadAirnodeConfig, mergeConfigs } from '../config';
import { buildLogOptions } from '../logger';
import {
  Config,
  GroupedSubscriptions,
  Id,
  State,
  CheckedSubscription,
  ProviderSponsorSubscriptions,
  GroupedProvider,
  AWSHandlerResponse,
} from '../types';
import { TIMEOUT_MS, RETRIES } from '../constants';
import { Subscription } from '../validator';

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();

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

const groupProviders = (config: Config) => {
  const evmChains = config.chains.filter((chain) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chains must be defined in the provided config');
  }
  const groupedProviders = evmChains.flatMap((chain) =>
    Object.entries(chain.providers).map(([providerName, chainProvider]) => {
      return {
        chainId: chain.id,
        providerName,
        providerUrl: chainProvider.url,
        chainConfig: chain,
      };
    })
  );

  const filteredGroupedProviders = groupedProviders.filter((p) => !isNil(p));

  return filteredGroupedProviders;
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
      const template = config.templates[templateId];
      if (isNil(template)) {
        utils.logger.warn(`TemplateId ${templateId} not found in templates`, baseLogOptions);
        return acc;
      }
      // Verify templateId
      const expectedTemplateId = ethers.utils.solidityKeccak256(
        ['bytes32', 'bytes'],
        [template.endpointId, template.templateParameters]
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

  const groupedProviders = groupProviders(config);

  return {
    config,
    baseLogOptions,
    groupedSubscriptions,
    groupedProviders,
    apiValuesBySubscriptionId: {},
  };
};

const executeApiCalls = async (state: State): Promise<State> => {
  const { config, baseLogOptions, groupedSubscriptions } = state;

  const apiValuePromises = groupedSubscriptions.map(({ subscriptions, template, endpoint }) => {
    const apiCallParameters = abi.decode(template.templateParameters);
    return go(
      async () => {
        const [logs, data] = await callApi(config, endpoint, apiCallParameters);
        return [logs, { templateId: template.id, apiValue: data, subscriptions }] as node.LogsData<{
          templateId: string;
          apiValue: ethers.BigNumber | null;
          subscriptions: Id<Subscription>[];
        }>;
      },
      { timeoutMs: TIMEOUT_MS, retries: RETRIES }
    );
  });
  const responses = await Promise.all(apiValuePromises);

  const apiValuesBySubscriptionId = responses.reduce((acc: { [subscriptionId: string]: ethers.BigNumber }, result) => {
    if (!result.success) {
      utils.logger.warn('Failed to fetch API value', baseLogOptions);
      return acc;
    }

    const [logs, data] = result.data;

    const templateLogOptions = buildLogOptions('additional', { templateId: data.templateId }, baseLogOptions);

    utils.logger.logPending(logs, templateLogOptions);

    if (isNil(data.apiValue)) {
      utils.logger.warn('Failed to fetch API value. Skipping update...', templateLogOptions);
      return acc;
    }

    return {
      ...acc,
      ...data.subscriptions.reduce((acc2, { id }) => {
        return { ...acc2, [id]: data.apiValue };
      }, {}),
    };
  }, {});

  return { ...state, apiValuesBySubscriptionId };
};

export const spawn = ({
  providerSponsorSubscription,
  baseLogOptions,
  type,
  stage,
}: {
  providerSponsorSubscription: ProviderSponsorSubscriptions;
  baseLogOptions: utils.LogOptions;
  type: 'local' | 'aws' | 'gcp';
  stage: string;
}) => {
  // lambda.invoke is synchronous so we need to wrap this in a promise
  switch (type) {
    case 'local':
      return new Promise((resolve, reject) => {
        processSubscriptionsHandler({ providerSponsorSubscription, baseLogOptions }).then((data) => {
          if (!data.ok) {
            reject(data.message);
          }
          resolve(data.message);
        });
      });
    case 'aws':
      return new Promise((resolve, reject) => {
        // Uses the current region by default
        const lambda = new AWS.Lambda();

        // AWS doesn't allow uppercase letters in lambda function names
        const resolvedName = `airkeeper-${stage}-process-subscriptions`;

        const options = {
          FunctionName: resolvedName,
          Payload: JSON.stringify({ providerSponsorSubscription, baseLogOptions }),
        };
        lambda.invoke(options, (err, data) => {
          // Reject invoke and (unhandled) handler errors
          if (err || data.FunctionError) {
            reject(err || data.FunctionError);
            return;
          }

          const parsedData: AWSHandlerResponse = JSON.parse(data.Payload as string);

          // Reject non-ok results
          if (!parsedData.ok) {
            reject(parsedData.message);
            return;
          }

          resolve(parsedData.message);
        });
      });
  }
};

const submitTransactions = async (state: State) => {
  const { baseLogOptions, groupedSubscriptions, apiValuesBySubscriptionId, groupedProviders, config } = state;

  const subscriptions = groupedSubscriptions.flatMap((s) => s.subscriptions);

  const providerSponsorSubscriptions = groupedProviders.reduce(
    (
      acc: {
        sponsorAddress: string;
        providerGroup: GroupedProvider;
        subscriptions: Id<CheckedSubscription>[];
      }[],
      providerGroup
    ) => {
      // Filter subscription by chainId, double-check that subscription has an associated API value and add
      // it to the subscription object
      const chainSubscriptions = subscriptions.reduce(
        (acc: (Id<Subscription> & { apiValue: ethers.BigNumber })[], subscription) => {
          if (subscription.chainId === providerGroup.chainId && apiValuesBySubscriptionId[subscription.id])
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
        providerGroup,
        subscriptions,
      }));

      return [...acc, ...subscriptionGroup];
    },
    []
  );

  const providerSponsorPromises = providerSponsorSubscriptions.map(async (providerSponsorSubscription) =>
    spawn({
      providerSponsorSubscription,
      baseLogOptions: baseLogOptions,
      type: config.nodeSettings.cloudProvider.type,
      stage: config.nodeSettings.stage,
    })
  );

  const providerSponsorResults = await Promise.allSettled(providerSponsorPromises);

  const groupedResults = providerSponsorResults.reduce(
    (acc: { fulfilled: any[]; rejected: any[] }, result) => {
      if (result.status === 'fulfilled') {
        acc.fulfilled.push(result);
      }
      if (result.status === 'rejected') {
        acc.rejected.push(result);
      }
      return acc;
    },
    { fulfilled: [], rejected: [] }
  );

  utils.logger.info(
    `Processed subscriptions; success: ${groupedResults.fulfilled.length}, failure: ${groupedResults.rejected.length}`,
    baseLogOptions
  );
};

const updateBeacon = async (config: Config) => {
  // =================================================================
  // STEP 1: Initialize state
  // =================================================================
  let state: State = initializeState(config);
  utils.logger.debug('Initial state created...', state.baseLogOptions);

  // **************************************************************************
  // STEP 2: Make API calls
  // **************************************************************************
  state = await executeApiCalls(state);
  utils.logger.debug('API requests executed...', state.baseLogOptions);

  // **************************************************************************
  // STEP 3. Initiate transactions for each provider, sponsor wallet pair
  // **************************************************************************
  await submitTransactions(state);
  utils.logger.debug('Transactions submitted...', state.baseLogOptions);

  return state;
};
