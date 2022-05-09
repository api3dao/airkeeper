import fs from 'fs';
import template from 'lodash/template';
import * as airnodeValidator from '@api3/airnode-validator';
import merge from 'lodash/merge';
import { z } from 'zod';
import { Config, configSchema } from './validator';

type Secrets = Record<string, string | undefined>;

export const readConfig = (configPath: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse config file. ${err}`);
  }
};

export const loadConfig = (configPath: string, secrets: Record<string, string | undefined>) => {
  const rawConfig = readConfig(configPath);
  const parsedConfigRes = parseConfigWithSecrets(rawConfig, secrets);
  if (!parsedConfigRes.success) {
    throw new Error(`Invalid Airkeeper configuration file: ${parsedConfigRes.error}`);
  }

  const config = parsedConfigRes.data;
  return config;
};

export const parseConfigWithSecrets = (config: unknown, secrets: unknown) => {
  const parseSecretsRes = parseSecrets(secrets);
  if (!parseSecretsRes.success) return parseSecretsRes;

  return parseConfig(interpolateSecrets(config, parseSecretsRes.data));
};

export const parseSecrets = (secrets: unknown) => {
  const secretsSchema = z.record(z.string());

  const result = secretsSchema.safeParse(secrets);
  return result;
};

export const parseConfig = (config: unknown) => {
  // Parse and validate Airnode config
  const airnodeValidationResult = airnodeValidator.parseConfig(config);
  if (!airnodeValidationResult.success) {
    return airnodeValidationResult;
  }

  // Parse and validate Airkeeper config
  const parseConfigRes = configSchema.safeParse(config);
  if (!parseConfigRes.success) {
    return parseConfigRes;
  }

  return {
    success: true,
    data: merge(airnodeValidationResult.data, parseConfigRes.data),
  } as z.SafeParseSuccess<Config>;
};

// Regular expression that does not match anything, ensuring no escaping or interpolation happens
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L199
const NO_MATCH_REGEXP = /($^)/;
// Regular expression matching ES template literal delimiter (${}) with escaping
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L175
const ES_MATCH_REGEXP = /\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;

export const interpolateSecrets = (config: unknown, secrets: Secrets) => {
  // TODO: Replace with go utils
  try {
    const interpolated = JSON.parse(
      template(JSON.stringify(config), {
        escape: NO_MATCH_REGEXP,
        evaluate: NO_MATCH_REGEXP,
        interpolate: ES_MATCH_REGEXP,
      })(secrets)
    );

    return interpolated;
  } catch (err) {
    throw new Error(`Error interpolating secrets. Make sure the secrets format is correct. ${err}`);
  }
};
