import { ethers } from 'ethers';
import { checkSubscriptionCondition } from './check-conditions';
import { dapiServerAbi } from './initialize-provider';
import * as utils from '../utils';

describe('checkSubscriptionCondition', () => {
  beforeEach(() => jest.restoreAllMocks());

  const subscription = {
    chainId: '31337',
    airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    templateId: '0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa',
    parameters: '0x',
    conditions:
      '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e4964000000000000000000000000dc96acc8000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000989680',
    relayer: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    sponsor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    requester: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    fulfillFunctionId: '0x206b48f4',
    id: '0x168194af62ab1b621eff3be1df9646f198dcef36f9eace0474fd19d47b2e0039',
  };
  const apiValue = ethers.BigNumber.from(723392020);
  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545/');
  const dapiServer = new ethers.Contract('0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', dapiServerAbi, provider);
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  it('should return true if subscription conditions check passes', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest.spyOn(utils, 'retryGo').mockResolvedValueOnce([null, [true]]);

    const [logs, data] = await checkSubscriptionCondition(subscription, apiValue, dapiServer, voidSigner);

    expect(retryGoSpy).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([]);
    expect(data).toEqual(true);
  });

  it('should return false if subscription conditions check does not passes', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest.spyOn(utils, 'retryGo').mockResolvedValueOnce([null, [false]]);

    const [logs, data] = await checkSubscriptionCondition(subscription, apiValue, dapiServer, voidSigner);

    expect(retryGoSpy).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      {
        level: 'WARN',
        message: 'Conditions not met. Skipping update...',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with error log if conditions decode fails', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest.spyOn(utils, 'retryGo').mockResolvedValueOnce([null, [true]]);

    const [logs, data] = await checkSubscriptionCondition(
      { ...subscription, conditions: '0xinvalid' },
      apiValue,
      dapiServer,
      voidSigner
    );

    expect(retryGoSpy).toHaveBeenCalledTimes(0);
    expect(logs).toEqual([
      {
        error: expect.objectContaining({ message: expect.stringContaining('invalid arrayify value') }),
        level: 'ERROR',
        message: 'Failed to decode conditions',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with error log if condition function returns an error', async () => {
    const unexpectedError = new Error('Something when wrong');
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest.spyOn(utils, 'retryGo').mockResolvedValueOnce([unexpectedError, null]);

    const [logs, data] = await checkSubscriptionCondition(subscription, apiValue, dapiServer, voidSigner);

    expect(retryGoSpy).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      {
        error: unexpectedError,
        level: 'ERROR',
        message: 'Failed to check conditions',
      },
    ]);
    expect(data).toEqual(false);
  });
  it('returns false with error log if conditions result is null', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest.spyOn(utils, 'retryGo').mockResolvedValueOnce([null, null]);

    const [logs, data] = await checkSubscriptionCondition(subscription, apiValue, dapiServer, voidSigner);

    expect(retryGoSpy).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      {
        level: 'ERROR',
        message: 'Failed to check conditions',
      },
    ]);
    expect(data).toEqual(false);
  });
});
