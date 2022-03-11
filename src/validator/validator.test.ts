import { readFileSync } from 'fs';
import { join } from 'path';
import { ZodError } from 'zod';
import { configSchema, validateConfig } from './validator';

describe('validator', () => {
  const airkeeperConfig = JSON.parse(readFileSync(join(__dirname, '../../config/airkeeper.example.json')).toString());

  describe('basic zod parsing', () => {
    it('successfully parses config.json specs', () => {
      expect(() => configSchema.parse(airkeeperConfig)).not.toThrow();
    });

    it('throws on missing fields', () => {
      const { airnodeAddress, ...rest } = airkeeperConfig;
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
      const { airnodeAddress, ...rest } = airkeeperConfig;
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
      expect(() => validateConfig(configSchema, airkeeperConfig)).not.toThrow();
      expect(validateConfig(configSchema, airkeeperConfig)).toEqual({ success: true, data: airkeeperConfig });
    });

    it('does not throw on missing field', () => {
      const { airnodeAddress, ...rest } = airkeeperConfig;
      expect(typeof airnodeAddress).toEqual('string');

      expect(() => validateConfig(configSchema, rest)).not.toThrow();
      expect(validateConfig(configSchema, rest)).toEqual({
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
      const { airnodeAddress, ...rest } = airkeeperConfig;
      expect(typeof airnodeAddress).toEqual('string');

      expect(() => validateConfig(configSchema, { airnodeAddress: 100 as any, ...rest })).not.toThrow();
      expect(validateConfig(configSchema, { airnodeAddress: 100, ...rest })).toEqual({
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
