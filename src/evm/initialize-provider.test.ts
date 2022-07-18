import { ethers } from 'ethers';
import { initializeEvmState, initializeProvider } from './initialize-provider';
import { BASE_FEE_MULTIPLIER, PRIORITY_FEE_IN_WEI } from '../constants';
import { ChainConfig } from '../types';

describe('initializeEvmState', () => {
  beforeEach(() => jest.restoreAllMocks());

  const providerUrl = 'http://localhost:8545';

  const chain: ChainConfig = {
    maxConcurrency: 100,
    authorizers: [],
    contracts: {
      AirnodeRrp: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
      RrpBeaconServer: '0xB7f8BC63BbcaD18155201308C8f3540b07f84F5e',
      DapiServer: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    },
    id: '31337',
    providers: { local: { url: providerUrl } },
    type: 'evm',
    options: {
      txType: 'eip1559',
      baseFeeMultiplier: 2,
      priorityFee: { value: 3.12, unit: 'gwei' },
      fulfillmentGasLimit: 500_000,
    },
  };

  test.each(['legacy', 'eip1559'] as const)('should initialize provider - txType: %s', async (txType) => {
    const getBlockNumberSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlockNumber');
    const currentBlock = Math.floor(Date.now() / 1000);
    getBlockNumberSpy.mockResolvedValueOnce(currentBlock);

    const { gasTarget, blockSpy, gasPriceSpy } = createAndMockGasTarget(txType);

    const [logs, data] = await initializeEvmState(
      {
        ...chain,
        options: {
          txType,
          baseFeeMultiplier: 2,
          priorityFee: { value: 3.12, unit: 'gwei' },
          fulfillmentGasLimit: 500_000,
        },
      },
      providerUrl
    );

    expect(getBlockNumberSpy).toHaveBeenCalled();
    expect(txType === 'legacy' ? blockSpy : gasPriceSpy).not.toHaveBeenCalled();
    expect(txType === 'eip1559' ? blockSpy : gasPriceSpy).toHaveBeenCalled();
    const gasPriceLogMessage =
      txType === 'legacy'
        ? expect.stringMatching(/Gas price \(legacy\) set to [0-9]*\.[0-9]+ Gwei/)
        : expect.stringMatching(
            /Gas price \(EIP-1559\) set to a Max Fee of [0-9]*\.[0-9]+ Gwei and a Priority Fee of [0-9]*\.[0-9]+ Gwei/
          );
    expect(logs).toEqual(
      expect.arrayContaining([
        { level: 'INFO', message: `Current block number for chainId 31337: ${currentBlock}` },
        {
          level: 'INFO',
          message: gasPriceLogMessage,
        },
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
    const getBlockNumberSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlockNumber');
    const errorMessage = 'could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.5.3)';
    getBlockNumberSpy.mockRejectedValue(new Error(errorMessage));

    const { blockSpy, gasPriceSpy } = createAndMockGasTarget('eip1559');

    const [logs, data] = await initializeEvmState(chain, providerUrl);

    expect(blockSpy).not.toHaveBeenCalled();
    expect(gasPriceSpy).not.toHaveBeenCalled();
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          error: expect.objectContaining({ message: expect.stringContaining('could not detect network') }),
          level: 'ERROR',
          message: 'Failed to fetch the blockNumber',
        }),
      ])
    );
    expect(data).toEqual(null);
  });

  it('returns null with error log if gas target cannot be fetched', async () => {
    const getBlockNumberSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlockNumber');
    const currentBlock = Math.floor(Date.now() / 1000);
    getBlockNumberSpy.mockResolvedValue(currentBlock);

    const gasPriceSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getGasPrice');
    const errorMessage = 'could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.5.3)';
    gasPriceSpy.mockRejectedValue(new Error(errorMessage));
    const blockSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlock');
    blockSpy.mockRejectedValue(new Error(errorMessage));

    const [logs, data] = await initializeEvmState(chain, providerUrl);

    expect(getBlockNumberSpy).toHaveBeenCalled();
    expect(logs).toEqual(expect.arrayContaining([{ level: 'ERROR', message: 'Failed to fetch gas price' }]));
    expect(data).toEqual(null);
  });

  it('should initialize provider and airnode wallet', async () => {
    const airnodeWalletMnemonic = 'achieve climb couple wait accident symbol spy blouse reduce foil echo label';
    const currentBlock = Math.floor(Date.now() / 1000);
    const { gasTarget } = createAndMockGasTarget('eip1559');

    const data = await initializeProvider(airnodeWalletMnemonic, {
      providerName: 'local',
      providerUrl: 'http://localhost:8545',
      chainId: '31337',
      chainConfig: chain,
      currentBlock,
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
 * Creates and mocks gas pricing-related resources based on txType.
 */
const createAndMockGasTarget = (txType: 'legacy' | 'eip1559') => {
  const gasPriceSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getGasPrice');
  const blockSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getBlock');
  const gasLimit = ethers.BigNumber.from(500_000);
  if (txType === 'legacy') {
    const gasPrice = ethers.BigNumber.from(1_000);
    gasPriceSpy.mockResolvedValue(gasPrice);
    return { gasTarget: { type: 0, gasPrice, gasLimit }, blockSpy, gasPriceSpy };
  }

  const baseFeePerGas = ethers.BigNumber.from(1000);
  blockSpy.mockResolvedValue({ baseFeePerGas } as ethers.providers.Block);
  const maxPriorityFeePerGas = ethers.BigNumber.from(PRIORITY_FEE_IN_WEI);
  const maxFeePerGas = baseFeePerGas.mul(BASE_FEE_MULTIPLIER).add(maxPriorityFeePerGas);

  return {
    gasTarget: { type: 2, maxPriorityFeePerGas, maxFeePerGas, gasLimit },
    blockSpy,
    gasPriceSpy,
  };
};
