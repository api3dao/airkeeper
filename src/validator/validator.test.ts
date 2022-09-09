import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
import { Config, configSchema, validateConfig } from './validator';
import { interpolateSecrets } from '../config';

const envVariables = {
  AIRNODE_WALLET_MNEMONIC: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  PROVIDER_URL: 'https://some.self.hosted.mainnet.url',
  SS_CURRENCY_CONVERTER_API_KEY: '18e06827-8544-4b0f-a639-33df3b5bc62f',
};

describe('validator', () => {
  const config: Config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../', 'config', 'airkeeper.example.json'), 'utf8')
  );
  const interpolatedConfig = interpolateSecrets(config, envVariables);
  if (!interpolatedConfig.success) {
    throw new Error('Secrets interpolation failed. Caused by: ' + interpolatedConfig.error.message);
  }

  describe('basic zod parsing', () => {
    it('successfully parses config.json specs', () => {
      expect(() => configSchema.parse(interpolatedConfig.data)).not.toThrow();
    });

    it('throws on missing fields', () => {
      const { nodeSettings, ...rest } = interpolatedConfig.data;
      expect(typeof nodeSettings).toEqual('object');
      expect(() => configSchema.parse(rest)).toThrow(
        new ZodError([
          {
            code: 'invalid_type',
            expected: 'object',
            received: 'undefined',
            path: ['nodeSettings'],
            message: 'Required',
          },
        ])
      );
    });

    it('throws on incorrect type', () => {
      const { nodeSettings, ...rest } = interpolatedConfig.data;
      const { airnodeAddress, ...restNodeSettings } = nodeSettings;
      expect(typeof airnodeAddress).toEqual('string');
      expect(() => configSchema.parse({ ...rest, nodeSettings: { airnodeAddress: 100, ...restNodeSettings } })).toThrow(
        new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['nodeSettings', 'airnodeAddress'],
            message: 'Expected string, received number',
          },
        ])
      );
    });
  });

  describe('validateConfig', () => {
    it('validates successfully', () => {
      expect(() => validateConfig(interpolatedConfig.data)).not.toThrow();
      expect(validateConfig(interpolatedConfig.data)).toEqual({ success: true, data: interpolatedConfig.data });
    });

    it('does not throw on missing optional field', () => {
      const { nodeSettings, ...rest } = interpolatedConfig.data;
      const { airnodeAddress, ...restNodeSettings } = nodeSettings;
      expect(typeof airnodeAddress).toEqual('string');

      const expectedConfig = { ...rest, nodeSettings: { ...restNodeSettings } };
      expect(validateConfig(expectedConfig)).toEqual({ success: true, data: expectedConfig });
    });
  });
});
