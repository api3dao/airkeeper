const getGasPriceMock = jest.fn();
jest.mock('@api3/airnode-utilities', () => {
  const original = jest.requireActual('@api3/airnode-utilities');
  return {
    ...original,
    getGasPrice: getGasPriceMock,
  };
});

import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { initializeEvmState, initializeProvider } from './initialize-provider';
import { BASE_FEE_MULTIPLIER, PRIORITY_FEE_IN_WEI } from '../constants';
import { ChainConfig } from '../validator';

describe('initializeEvmState', () => {
  beforeEach(() => jest.restoreAllMocks());

  const providerUrl = 'http://localhost:8545';

  const chain: ChainConfig = {
    contracts: {
      AirnodeRrp: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      RrpBeaconServer: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
      DapiServer: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    },
    id: '31337',
    providers: { local: { url: providerUrl } },
    type: 'evm',
    options: {
      fulfillmentGasLimit: 500000,
      gasPriceOracle: [
        {
          gasPriceStrategy: 'constantGasPrice',
          gasPrice: {
            value: 10,
            unit: 'gwei',
          },
        },
      ],
    },
  };

  test.each(['legacy', 'eip1559'] as const)('should initialize provider - txType: %s', async (txType) => {
    const getBlockSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlock');
    const currentBlock = { number: Math.floor(Date.now() / 1000), timestamp: Date.now() };
    getBlockSpy.mockResolvedValueOnce(currentBlock as ethers.providers.Block);

    const gasTarget = createGasTarget(txType);
    getGasPriceMock.mockResolvedValue([[], gasTarget]);

    const [logs, data] = await initializeEvmState(
      {
        ...chain,
        options: {
          fulfillmentGasLimit: 500000,
          gasPriceOracle: [
            ...(txType === 'eip1559'
              ? [
                  {
                    gasPriceStrategy: 'providerRecommendedEip1559GasPrice',
                    baseFeeMultiplier: 2,
                    priorityFee: {
                      value: 3.12,
                      unit: 'gwei',
                    },
                  },
                ]
              : []),
            {
              gasPriceStrategy: 'constantGasPrice',
              gasPrice: {
                value: 10,
                unit: 'gwei',
              },
            },
          ] as any,
        },
      },
      providerUrl
    );

    expect(getBlockSpy).toHaveBeenNthCalledWith(1, 'latest');
    expect(getGasPriceMock).toHaveBeenCalledTimes(1);
    expect(logs).toEqual(
      expect.arrayContaining([
        { level: 'INFO', message: `Current block number for chainId 31337: ${currentBlock.number}` },
      ])
    );
    expect(data).toEqual(
      expect.objectContaining({
        currentBlock,
        gasTarget,
      })
    );
  });

  it('returns null with error log if current block cannot be fetched', async () => {
    const getBlockSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlock');
    const errorMessage = 'could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.5.3)';
    getBlockSpy.mockRejectedValue(new Error(errorMessage));

    const [logs, data] = await initializeEvmState(chain, providerUrl);

    expect(getBlockSpy).toHaveBeenCalled();
    expect(getGasPriceMock).not.toHaveBeenCalled();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          error: expect.objectContaining({ message: expect.stringContaining('could not detect network') }),
          level: 'ERROR',
          message: 'Failed to fetch the block',
        }),
      ])
    );
    expect(data).toEqual(null);
  });

  it('should initialize provider and airnode wallet', async () => {
    const airnodeWalletMnemonic = 'achieve climb couple wait accident symbol spy blouse reduce foil echo label';
    const currentBlock = { number: Math.floor(Date.now() / 1000), timestamp: Date.now() };
    const gasTarget = createGasTarget('eip1559');

    const data = await initializeProvider(airnodeWalletMnemonic, {
      providerName: 'local',
      providerUrl: 'http://localhost:8545',
      chainId: '31337',
      chainConfig: chain,
      currentBlock: currentBlock as ethers.providers.Block,
      gasTarget,
    });
    expect(data).toEqual(
      expect.objectContaining({
        airnodeWallet: expect.any(ethers.Wallet),
        provider: expect.any(ethers.providers.JsonRpcProvider),
        contracts: expect.objectContaining({
          RrpBeaconServer: expect.any(ethers.Contract),
          DapiServer: expect.any(ethers.Contract),
        }),
        voidSigner: expect.any(ethers.VoidSigner),
      })
    );
  });
});

/**
 * Creates gas pricing-related resources based on txType.
 */
const createGasTarget = (txType: 'legacy' | 'eip1559'): utils.GasTarget => {
  const gasLimit = ethers.BigNumber.from(500_000);

  if (txType === 'legacy') {
    const gasPrice = ethers.BigNumber.from(1_000);
    return { type: 0, gasPrice, gasLimit };
  }

  const baseFeePerGas = ethers.BigNumber.from(1000);
  const maxPriorityFeePerGas = ethers.BigNumber.from(PRIORITY_FEE_IN_WEI);
  const maxFeePerGas = baseFeePerGas.mul(BASE_FEE_MULTIPLIER).add(maxPriorityFeePerGas);

  return {
    type: 2,
    maxPriorityFeePerGas,
    maxFeePerGas,
    gasLimit,
  };
};
