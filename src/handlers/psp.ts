import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go, goSync } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { Dictionary } from 'lodash';
import groupBy from 'lodash/groupBy';
import isEmpty from 'lodash/isEmpty';
import isNil from 'lodash/isNil';
import { callApi } from '../api/call-api';
import { loadAirkeeperConfig, loadAirnodeConfig, mergeConfigs } from '../config';
import {
  checkSubscriptionCondition,
  getSponsorWalletAndTransactionCount,
  initializeProvider,
  processSponsorWallet,
} from '../evm';
import { buildLogOptions } from '../logger';
import {
  CheckedSubscription,
  Config,
  EVMProviderState,
  GroupedSubscriptions,
  Id,
  ProviderState,
  SponsorWalletTransactionCount,
  SponsorWalletWithSubscriptions,
  State,
} from '../types';
import { TIMEOUT_MS } from '../constants';
import { Subscription } from '../validator';
import { shortenAddress } from '../wallet';

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

  return {
    config,
    baseLogOptions,
    groupedSubscriptions,
    apiValuesBySubscriptionId: {},
    providerStates: [],
  };
};

const executeApiCalls = async (state: State): Promise<State> => {
  const { config, baseLogOptions, groupedSubscriptions } = state;

  const apiValuePromises = groupedSubscriptions.map(({ subscriptions, template, endpoint }) => {
    const apiCallParameters = abi.decode(template.templateParameters);
    return go(
      () =>
        callApi(config, endpoint, apiCallParameters).then(
          ([logs, data]) =>
            [logs, { templateId: template.id, apiValue: data, subscriptions }] as node.LogsData<{
              templateId: string;
              apiValue: ethers.BigNumber | null;
              subscriptions: Id<Subscription>[];
            }>
        ),
      { timeoutMs: TIMEOUT_MS, retries: 1 }
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

const initializeProviders = async (state: State): Promise<State> => {
  const { config, baseLogOptions } = state;

  const airnodeWallet = ethers.Wallet.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic);

  const evmChains = config.chains.filter((chain) => chain.type === 'evm');
  if (isEmpty(evmChains)) {
    throw new Error('One or more evm compatible chains must be defined in the provided config');
  }
  const providerPromises = evmChains.flatMap((chain) =>
    Object.entries(chain.providers).map(async ([providerName, chainProvider]) => {
      const providerLogOptions = buildLogOptions('meta', { chainId: chain.id, providerName }, baseLogOptions);

      // Initialize provider specific data
      const [logs, evmProviderState] = await initializeProvider(chain, chainProvider.url || '');
      utils.logger.logPending(logs, providerLogOptions);
      if (isNil(evmProviderState)) {
        utils.logger.warn('Failed to initialize provider', providerLogOptions);
        return null;
      }

      return {
        airnodeWallet,
        chainId: chain.id,
        providerName,
        ...evmProviderState,
      };
    })
  );

  const providerStates = await Promise.all(providerPromises);
  const validProviderStates = providerStates.filter((ps) => !isNil(ps)) as ProviderState<EVMProviderState>[];

  return { ...state, providerStates: validProviderStates };
};

const checkSubscriptionsConditions = async (
  subscriptions: Id<Subscription>[],
  apiValuesBySubscriptionId: { [subscriptionId: string]: ethers.BigNumber },
  contract: ethers.Contract,
  voidSigner: ethers.VoidSigner,
  logOptions: utils.LogOptions
) => {
  const conditionPromises = subscriptions.map(
    (subscription) =>
      checkSubscriptionCondition(subscription, apiValuesBySubscriptionId[subscription.id], contract, voidSigner).then(
        ([logs, isValid]) => [logs, { subscription, isValid }]
      ) as Promise<node.LogsData<{ subscription: Id<Subscription>; isValid: boolean }>>
  );
  const result = await Promise.all(conditionPromises);
  const validSubscriptions = result.reduce((acc: CheckedSubscription[], [log, data]) => {
    const subscriptionLogOptions = buildLogOptions('additional', { subscriptionId: data.subscription.id }, logOptions);

    utils.logger.logPending(log, subscriptionLogOptions);

    if (data.isValid) {
      return [
        ...acc,
        {
          ...data.subscription,
          apiValue: apiValuesBySubscriptionId[data.subscription.id],
        },
      ];
    }

    return acc;
  }, []);

  return validSubscriptions;
};

const groupSubscriptionsBySponsorWallet = async (
  subscriptionsBySponsor: Dictionary<CheckedSubscription[]>,
  airnodeWallet: ethers.Wallet,
  provider: ethers.providers.Provider,
  currentBlock: number,
  providerLogOptions: utils.LogOptions
): Promise<SponsorWalletWithSubscriptions[]> => {
  const sponsorAddresses = Object.keys(subscriptionsBySponsor);
  const sponsorWalletAndTransactionCountPromises = sponsorAddresses.map(
    (sponsor) =>
      getSponsorWalletAndTransactionCount(airnodeWallet, provider, currentBlock, sponsor).then(([logs, data]) => [
        logs,
        { ...data, sponsor },
      ]) as Promise<node.LogsData<(SponsorWalletTransactionCount | null) & { sponsor: string }>>
  );
  const sponsorWalletsAndTransactionCounts = await Promise.all(sponsorWalletAndTransactionCountPromises);
  const sponsorWalletsWithSubscriptions = sponsorWalletsAndTransactionCounts.reduce(
    (acc: SponsorWalletWithSubscriptions[], [logs, data]) => {
      const sponsorLogOptions = buildLogOptions('additional', { sponsor: data.sponsor }, providerLogOptions);

      utils.logger.logPending(logs, sponsorLogOptions);

      if (isNil(data.sponsorWallet) || isNil(data.transactionCount)) {
        utils.logger.warn('Failed to fetch sponsor wallet or transaction count', sponsorLogOptions);
        return acc;
      }

      return [
        ...acc,
        {
          subscriptions: subscriptionsBySponsor[data.sponsor].map((subscription, idx) => ({
            ...subscription,
            nonce: data.transactionCount + idx,
          })),
          sponsorWallet: data.sponsorWallet,
        },
      ];
    },
    []
  );

  return sponsorWalletsWithSubscriptions;
};

const submitTransactions = async (state: State) => {
  const { baseLogOptions, groupedSubscriptions, apiValuesBySubscriptionId, providerStates } = state;

  const providerPromises = providerStates.map(async (providerState) => {
    const { airnodeWallet, providerName, chainId, provider, contracts, voidSigner, currentBlock, gasTarget } =
      providerState;

    const providerLogOptions = buildLogOptions('meta', { chainId, providerName }, baseLogOptions);

    // Get subscriptions from template/endnpoint groups
    const subscriptions = groupedSubscriptions.flatMap((s) => s.subscriptions);

    // Filter subscription by chainId and doblue-check that subscription has an associated API value
    const chainSubscriptions = subscriptions.filter(
      (subscription) => subscription.chainId === chainId && apiValuesBySubscriptionId[subscription.id]
    );

    // Check conditions
    const validSubscriptions = await checkSubscriptionsConditions(
      chainSubscriptions,
      apiValuesBySubscriptionId,
      contracts['DapiServer'],
      voidSigner,
      providerLogOptions
    );

    // Group subscriptions by sponsor address
    const subscriptionsBySponsor = groupBy(validSubscriptions, 'sponsor');

    // Fetch sponsor wallet transaction counts to be able to assign nonces
    // to subscriptions and group subscriptions by sponsor wallet
    const subscriptionsBySponsorWallets = await groupSubscriptionsBySponsorWallet(
      subscriptionsBySponsor,
      airnodeWallet,
      provider,
      currentBlock,
      providerLogOptions
    );

    // Process sponsor wallets in parallel
    const sponsorWalletPromises = subscriptionsBySponsorWallets.map(async ({ subscriptions, sponsorWallet }) => {
      const sponsorWalletLogOptions = buildLogOptions(
        'additional',
        { sponsorWallet: shortenAddress(sponsorWallet.address) },
        providerLogOptions
      );

      utils.logger.info(`Processing ${subscriptions.length} subscription(s)`, sponsorWalletLogOptions);

      const logs = await processSponsorWallet(
        airnodeWallet,
        contracts['DapiServer'],
        gasTarget,
        subscriptions,
        sponsorWallet
      );

      logs.forEach(([logs, data]) => {
        const subscriptionLogOptions = buildLogOptions(
          'additional',
          { subscriptionId: data.id },
          sponsorWalletLogOptions
        );
        utils.logger.logPending(logs, subscriptionLogOptions);
      });
    });

    await Promise.all(sponsorWalletPromises);
  });

  await Promise.all(providerPromises);
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
  // STEP 3. Initialize providers
  // **************************************************************************
  state = await initializeProviders(state);
  utils.logger.debug('Providers initialized...', state.baseLogOptions);

  // **************************************************************************
  // STEP 4. Initiate transactions for each provider, sponsor wallet pair
  // **************************************************************************
  await submitTransactions(state);
  utils.logger.debug('Transactions submitted...', state.baseLogOptions);

  return state;
};
