import fs from 'fs';
import path from 'path';
import * as node from '@api3/airnode-node';
import isNil from 'lodash/isNil';
import merge from 'lodash/merge';
import { validateConfig, AirkeeperConfig } from './validator';

export const loadAirnodeConfig = () => {
  // This file must be the same as the one used by the @api3/airnode-node
  const nodeConfigPath = path.resolve(__dirname, '..', '..', 'config', `config.json`);

  const { config, shouldSkipValidation, validationOutput } = node.config.parseConfig(nodeConfigPath, process.env, true);

  // TODO: Log debug that validation is skipped
  if (shouldSkipValidation) return config;
  if (!validationOutput.valid) {
    throw new Error(`Invalid Airnode configuration file: ${JSON.stringify(validationOutput.messages, null, 2)}`);
  }
  // TODO: Log validation warnings - currently not possible since we have troubles constructing logger options
  return config;
};

export const loadAirkeeperConfig = () => {
  const configPath = path.resolve(__dirname, '..', '..', 'config', `airkeeper.json`);
  const airkeeperConfig = JSON.parse(fs.readFileSync(configPath, 'utf8'));

  const validationOutput = validateConfig(airkeeperConfig);
  if (!validationOutput.success) {
    throw new Error(`Invalid Airkeeper configuration file: ${JSON.stringify(validationOutput.error, null, 2)}`);
  }

  return validationOutput.data;
};

export const mergeConfigs = (airnodeConfig: node.Config, airkeeperConfig: AirkeeperConfig) => {
  return {
    ...airnodeConfig,
    chains: airkeeperConfig.chains.map((chain) => {
      if (isNil(chain.id)) {
        throw new Error(`Missing 'id' property in chain config: ${JSON.stringify(chain)}`);
      }
      const configChain = airnodeConfig.chains.find((c) => c.id === chain.id);
      if (isNil(configChain)) {
        throw new Error(`Chain id ${chain.id} not found in node config.json`);
      }
      return merge(configChain, chain);
    }),
    triggers: { ...airnodeConfig.triggers, ...airkeeperConfig.triggers },
    subscriptions: airkeeperConfig.subscriptions,
    templates: airkeeperConfig.templates,
    endpoints: airkeeperConfig.endpoints,
  };
};
