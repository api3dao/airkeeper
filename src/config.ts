import fs from 'fs';
import { ValidationResult } from '@api3/airnode-validator';
import { goSync } from '@api3/promise-utils';
import template from 'lodash/template';
import { z } from 'zod';
import { Config, configSchema } from './validator';

type Secrets = Record<string, string | undefined>;

export const loadConfig = (configPath: string, secrets: Record<string, string | undefined>) => {
  const rawConfig = readConfig(configPath);
  const parsedConfigRes = parseConfigWithSecrets(rawConfig, secrets);
  if (!parsedConfigRes.success) {
    throw new Error(`Invalid Airkeeper configuration file: ${parsedConfigRes.error}`);
  }

  const config = parsedConfigRes.data;
  return config;
};

export const readConfig = (configPath: string): unknown => {
  try {
    return JSON.parse(fs.readFileSync(configPath, 'utf8'));
  } catch (err) {
    throw new Error(`Failed to parse config file. ${err}`);
  }
};

export const parseConfigWithSecrets = (config: unknown, secrets: unknown): ValidationResult<Config> => {
  const parseSecretsRes = parseSecrets(secrets);
  if (!parseSecretsRes.success) return parseSecretsRes;

  const interpolateConfigRes = interpolateSecrets(config, parseSecretsRes.data);
  if (!interpolateConfigRes.success) {
    return {
      success: false,
      error: new Error('Secrets interpolation failed. Caused by: ' + interpolateConfigRes.error.message),
    };
  }

  return parseConfig(interpolateConfigRes.data);
};

export const parseSecrets = (secrets: unknown) => {
  const secretsSchema = z.record(z.string());

  const result = secretsSchema.safeParse(secrets);
  return result;
};

export const parseConfig = (config: unknown) => {
  const parseConfigRes = configSchema.safeParse(config);
  return parseConfigRes;
};

// Regular expression that does not match anything, ensuring no escaping or interpolation happens
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L199
const NO_MATCH_REGEXP = /($^)/;
// Regular expression matching ES template literal delimiter (${}) with escaping
// https://github.com/lodash/lodash/blob/4.17.15/lodash.js#L175
const ES_MATCH_REGEXP = /(?<!\\)\$\{([^\\}]*(?:\\.[^\\}]*)*)\}/g;
// Regular expression matching the escaped ES template literal delimiter (${}). We need to use "\\\\" (four backslashes)
// because "\\" becomes "\\\\" when converted to string
const ESCAPED_ES_MATCH_REGEXP = /\\\\(\$\{([^\\}]*(?:\\.[^\\}]*)*)\})/g;

export function interpolateSecrets<T>(config: T, secrets: Secrets): ValidationResult<T> {
  const interpolationRes = goSync(() =>
    JSON.parse(
      template(JSON.stringify(config), {
        escape: NO_MATCH_REGEXP,
        evaluate: NO_MATCH_REGEXP,
        interpolate: ES_MATCH_REGEXP,
      })(secrets)
    )
  );

  if (!interpolationRes.success) return interpolationRes;

  const interpolatedConfig = JSON.stringify(interpolationRes.data);
  // Un-escape the escaped config interpolations (e.g. to enable interpolation in processing snippets)
  return goSync(() => JSON.parse(interpolatedConfig.replace(ESCAPED_ES_MATCH_REGEXP, '$1')));
}
