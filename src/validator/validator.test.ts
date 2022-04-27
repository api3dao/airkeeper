import fs from 'fs';
import path from 'path';
import { ZodError } from 'zod';
import { configSchema, validateConfig } from './validator';
import { interpolateSecrets } from '../config';

const envVariables = {
  AIRNODE_WALLET_MNEMONIC: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
  PROVIDER_URL: 'https://some.self.hosted.mainnet.url',
  SS_CURRENCY_CONVERTER_API_KEY: '18e06827-8544-4b0f-a639-33df3b5bc62f',
};

describe('validator', () => {
  const config = JSON.parse(
    fs.readFileSync(path.join(__dirname, '../../', 'config', 'airkeeper.example.json'), 'utf8')
  );
  const interpolatedConfig = interpolateSecrets(config, envVariables);

  describe('basic zod parsing', () => {
    it('successfully parses config.json specs', () => {
      expect(() => configSchema.parse(interpolatedConfig)).not.toThrow();
    });

    it('throws on missing fields', () => {
      const { airnodeAddress, ...rest } = interpolatedConfig;
      expect(typeof airnodeAddress).toEqual('string');
      expect(() => configSchema.parse(rest)).toThrow(
        new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['airnodeAddress'],
            message: 'Required',
          },
        ])
      );
    });

    it('throws on incorrect type', () => {
      const { airnodeAddress, ...rest } = interpolatedConfig;
      expect(typeof airnodeAddress).toEqual('string');
      expect(() => configSchema.parse({ airnodeAddress: 100, ...rest })).toThrow(
        new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['airnodeAddress'],
            message: 'Expected string, received number',
          },
        ])
      );
    });
  });

  describe('validateConfig', () => {
    it('validates successfully', () => {
      expect(() => validateConfig(interpolatedConfig)).not.toThrow();
      expect(validateConfig(interpolatedConfig)).toEqual({ success: true, data: interpolatedConfig });
    });

    it('does not throw on missing field', () => {
      const { airnodeAddress, ...rest } = interpolatedConfig;
      expect(typeof airnodeAddress).toEqual('string');

      expect(() => validateConfig(rest)).not.toThrow();
      expect(validateConfig(rest)).toEqual({
        success: false,
        error: new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'undefined',
            path: ['airnodeAddress'],
            message: 'Required',
          },
        ]),
      });
    });

    it('does not throw on incorrect type', () => {
      const { airnodeAddress, ...rest } = interpolatedConfig;
      expect(typeof airnodeAddress).toEqual('string');

      expect(() => validateConfig({ airnodeAddress: 100 as any, ...rest })).not.toThrow();
      expect(validateConfig({ airnodeAddress: 100, ...rest })).toEqual({
        success: false,
        error: new ZodError([
          {
            code: 'invalid_type',
            expected: 'string',
            received: 'number',
            path: ['airnodeAddress'],
            message: 'Expected string, received number',
          },
        ]),
      });
    });
  });
});
