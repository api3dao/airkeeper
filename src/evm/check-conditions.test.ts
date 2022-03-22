import { ethers } from 'ethers';
import { checkSubscriptionCondition } from './check-conditions';

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
  const getFunctionMock = (_nameOrSignatureOrSighash: string) => {
    return {
      name: 'conditionPspBeaconUpdate',
    };
  };
  const getFunctionSpy = jest.fn().mockImplementation(getFunctionMock);
  const conditionPspBeaconUpdateMock = (
    _subscriptionId: string,
    _encodedFulfillmentData: string,
    _conditionParameters: string
  ) => Promise.resolve([true]);
  const conditionPspBeaconUpdateSpy = jest.fn().mockImplementation(conditionPspBeaconUpdateMock);
  const dapiServerMock = {
    connect(_signerOrProvider: ethers.Signer | ethers.providers.Provider | string) {
      return this;
    },
    interface: {
      getFunction: getFunctionSpy,
    },
    functions: {
      conditionPspBeaconUpdate: conditionPspBeaconUpdateSpy,
    },
  };
  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545/');
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);

  it('should return true if subscription conditions check passes', async () => {
    const [logs, data] = await checkSubscriptionCondition(subscription, apiValue, dapiServerMock as any, voidSigner);

    expect(getFunctionSpy).toHaveBeenNthCalledWith(1, '0xdc96acc8');
    expect(conditionPspBeaconUpdateSpy).toHaveBeenNthCalledWith(
      1,
      subscription.id,
      '0x000000000000000000000000000000000000000000000000000000002b1e1614',
      '0x0000000000000000000000000000000000000000000000000000000000989680'
    );
    expect(logs).toEqual([]);
    expect(data).toEqual(true);
  });

  it('should return false if subscription conditions check does not passes', async () => {
    const [logs, data] = await checkSubscriptionCondition(
      subscription,
      apiValue,
      {
        ...dapiServerMock,
        functions: {
          conditionPspBeaconUpdate: (
            _subscriptionId: string,
            _encodedFulfillmentData: string,
            _conditionParameters: string
          ) => Promise.resolve([false]),
        },
      } as any,
      voidSigner
    );

    expect(getFunctionSpy).toHaveBeenCalledTimes(1);
    expect(conditionPspBeaconUpdateSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        level: 'WARN',
        message: 'Conditions not met. Skipping update...',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with error log if conditions decode fails', async () => {
    const [logs, data] = await checkSubscriptionCondition(
      { ...subscription, conditions: '0xinvalid' },
      apiValue,
      dapiServerMock as any,
      voidSigner
    );

    expect(getFunctionSpy).not.toHaveBeenCalled();
    expect(conditionPspBeaconUpdateSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        error: expect.objectContaining({ message: expect.stringContaining('invalid arrayify value') }),
        level: 'ERROR',
        message: 'Failed to decode conditions',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with error log if conditions function does not exist in ABI', async () => {
    const getFunctionErrorSpy = jest.fn().mockImplementation((_nameOrSignatureOrSighash: string) => {
      throw new Error(
        'ERROR Error: no matching function (argument="name", value="0xinvalid", code=INVALID_ARGUMENT, version=abi/5.6.0)'
      );
    });

    const [logs, data] = await checkSubscriptionCondition(
      {
        ...subscription,
        conditions:
          '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e496400000000000000000000000011e4b036000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000989680',
      },
      apiValue,
      { ...dapiServerMock, interface: { getFunction: getFunctionErrorSpy } } as any,
      voidSigner
    );

    expect(getFunctionSpy).not.toHaveBeenCalled();
    expect(getFunctionErrorSpy).toHaveBeenCalledTimes(1);
    expect(conditionPspBeaconUpdateSpy).not.toHaveBeenCalled();
    expect(logs).toEqual([
      {
        error: expect.objectContaining({ message: expect.stringContaining('no matching function') }),
        level: 'ERROR',
        message: 'Failed to decode conditions',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with error log if condition function returns an error', async () => {
    const unexpectedError = new Error('Something when wrong');
    const conditionPspBeaconUpdateErrorSpy = jest
      .fn()
      .mockImplementation((_subscriptionId: string, _encodedFulfillmentData: string, _conditionParameters: string) =>
        Promise.reject(unexpectedError)
      );

    const [logs, data] = await checkSubscriptionCondition(
      subscription,
      apiValue,
      {
        ...dapiServerMock,
        functions: {
          conditionPspBeaconUpdate: conditionPspBeaconUpdateErrorSpy,
        },
      } as any,
      voidSigner
    );

    expect(getFunctionSpy).toHaveBeenCalledTimes(1);
    expect(conditionPspBeaconUpdateSpy).not.toHaveBeenCalled();
    expect(conditionPspBeaconUpdateErrorSpy).toHaveBeenCalledTimes(2);
    expect(logs).toEqual([
      {
        error: unexpectedError,
        level: 'ERROR',
        message: 'Failed to check conditions',
      },
    ]);
    expect(data).toEqual(false);
  });

  it('returns false with warn log if conditions result is undefined', async () => {
    const conditionPspBeaconUpdateNullSpy = jest
      .fn()
      .mockImplementation((_subscriptionId: string, _encodedFulfillmentData: string, _conditionParameters: string) =>
        Promise.resolve(undefined)
      );
    const [logs, data] = await checkSubscriptionCondition(
      subscription,
      apiValue,
      {
        ...dapiServerMock,
        functions: {
          conditionPspBeaconUpdate: conditionPspBeaconUpdateNullSpy,
        },
      } as any,
      voidSigner
    );

    expect(getFunctionSpy).toHaveBeenCalledTimes(1);
    expect(conditionPspBeaconUpdateSpy).not.toHaveBeenCalled();
    expect(conditionPspBeaconUpdateNullSpy).toHaveBeenCalledTimes(1);
    expect(logs).toEqual([
      {
        level: 'WARN',
        message: 'Conditions not met. Skipping update...',
      },
    ]);
    expect(data).toEqual(false);
  });
});
