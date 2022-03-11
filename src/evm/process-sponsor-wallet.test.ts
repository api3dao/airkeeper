import { ethers } from 'ethers';
import { dapiServerAbi } from './initialize-provider';
import { processSponsorWallet } from './process-sponsor-wallet';
import { deriveSponsorWallet } from '../wallet';
import * as utils from '../utils';

describe('processSponsorWallet', () => {
  beforeEach(() => jest.restoreAllMocks());

  const airnodeWallet = ethers.Wallet.fromMnemonic(
    'achieve climb couple wait accident symbol spy blouse reduce foil echo label'
  );
  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545/');
  const dapiServer = new ethers.Contract('0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0', dapiServerAbi, provider);
  const gasTarget = {
    maxPriorityFeePerGas: ethers.BigNumber.from(3120000000),
    maxFeePerGas: ethers.BigNumber.from(3866792752),
  };
  const subscription1 = {
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
    apiValue: ethers.BigNumber.from(723392020),
    nonce: 0,
  };
  const subscription2 = {
    chainId: '31337',
    airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    templateId: '0xea30f92923ece1a97af69d450a8418db31be5a26a886540a13c09c739ba8eaaa',
    parameters: '0x',
    conditions:
      '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e4964000000000000000000000000dc96acc8000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000001312d00',
    relayer: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    sponsor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    requester: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    fulfillFunctionId: '0x206b48f4',
    id: '0x6efac1aca63fe97cbb96498d49e600397eb118956bc84a600e08f6eaa95a882e',
    apiValue: ethers.BigNumber.from(723392020),
    nonce: 1,
  };
  const subscription3 = {
    chainId: '31337',
    airnodeAddress: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    templateId: '0x0bbf5f2ec4b0e9faf5b89b4ddbed9bdad7a542cc258ffd7b106b523aeae039a6',
    parameters: '0x',
    conditions:
      '0x31624200000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e46756e6374696f6e4964000000000000000000000000dc96acc8000000000000000000000000000000000000000000000000000000005f636f6e646974696f6e506172616d657465727300000000000000000000000000000000000000000000000000000000000000000000000000000000000000a000000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000989680',
    relayer: '0xA30CA71Ba54E83127214D3271aEA8F5D6bD4Dace',
    sponsor: '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    requester: '0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0',
    fulfillFunctionId: '0x206b48f4',
    id: '0xb8bf267396f5acdb28a2b50da3a236c0e29db1e222df25d12a50f68cb55d4f71',
    apiValue: ethers.BigNumber.from(46640440000),
    nonce: 2,
  };
  const subscriptions = [subscription1, subscription2, subscription3];
  const sponsorWallet = deriveSponsorWallet(
    airnodeWallet.mnemonic.phrase,
    '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC',
    '2'
  ).connect(provider);

  it('should process all subscriptions for a single sponsor wallet', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest
      .spyOn(utils, 'retryGo')
      .mockResolvedValue([null, { hash: ethers.utils.keccak256(ethers.utils.randomBytes(32)) }]);

    const logsData = await processSponsorWallet(airnodeWallet, dapiServer, gasTarget, subscriptions, sponsorWallet);

    expect(retryGoSpy).toHaveBeenCalledTimes(3);
    expect(logsData).toEqual(
      expect.arrayContaining([
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription1,
        ],
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription2,
        ],
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription3,
        ],
      ])
    );
  });

  it('returns processed subscriptions with logs up until error occurs while getting function fragment from contract interface', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest
      .spyOn(utils, 'retryGo')
      .mockResolvedValueOnce([null, { hash: ethers.utils.keccak256(ethers.utils.randomBytes(32)) }])
      .mockResolvedValueOnce([null, { hash: ethers.utils.keccak256(ethers.utils.randomBytes(32)) }])
      .mockResolvedValueOnce([null, { hash: ethers.utils.keccak256(ethers.utils.randomBytes(32)) }]);

    const invalidSubscription3 = { ...subscription3, fulfillFunctionId: '0xinvalid' };
    const logsData = await processSponsorWallet(
      airnodeWallet,
      dapiServer,
      gasTarget,
      [...subscriptions, invalidSubscription3],
      sponsorWallet
    );

    expect(retryGoSpy).toHaveBeenCalledTimes(3);
    expect(logsData).toEqual(
      expect.arrayContaining([
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription1,
        ],
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription2,
        ],
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription3,
        ],
        [
          [
            {
              error: expect.objectContaining({ message: expect.stringContaining('no matching function') }),
              level: 'ERROR',
              message: `Failed to get fulfill function`,
            },
          ],
          invalidSubscription3,
        ],
      ])
    );
  });

  it('returns processed subscriptions with logs up until error occurs during contract call', async () => {
    // TODO: Mocking retryGo because it is not trivial to mock the contract object
    const retryGoSpy = jest
      .spyOn(utils, 'retryGo')
      .mockResolvedValueOnce([null, { hash: ethers.utils.keccak256(ethers.utils.randomBytes(32)) }]);

    const logsData = await processSponsorWallet(airnodeWallet, dapiServer, gasTarget, subscriptions, sponsorWallet);

    expect(retryGoSpy).toHaveBeenCalledTimes(2);
    expect(logsData).toEqual(
      expect.arrayContaining([
        [
          [
            {
              level: 'INFO',
              message: expect.stringMatching(/Tx submitted: 0x[A-Fa-f0-9]{64}/),
            },
          ],
          subscription1,
        ],
        [
          [
            {
              error: expect.any(Error),
              level: 'ERROR',
              message: `Failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${subscription2.nonce}`,
            },
          ],
          subscription2,
        ],
      ])
    );
  });
});
