import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { getSponsorWalletAndTransactionCount } from './transaction-count';
import { PROTOCOL_ID_PSP } from '../constants';

describe('getSponsorWalletAndTransactionCount', () => {
  const airnodeWallet = ethers.Wallet.fromMnemonic(
    'achieve climb couple wait accident symbol spy blouse reduce foil echo label'
  );
  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545/');
  const currentBlock = Math.floor(Date.now() / 1000);
  const sponsor = '0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC';

  it('should return sponsor wallet and transaction count', async () => {
    const getTransactionCountSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getTransactionCount');
    const transactionCount = 25;
    getTransactionCountSpy.mockResolvedValueOnce(transactionCount);

    const [logs, data] = await getSponsorWalletAndTransactionCount(airnodeWallet, provider, currentBlock, sponsor);

    expect(getTransactionCountSpy).toHaveBeenNthCalledWith(
      1,
      node.evm.deriveSponsorWalletFromMnemonic(airnodeWallet.mnemonic.phrase, sponsor, PROTOCOL_ID_PSP).address,
      expect.any(Number)
    );
    expect(logs).toEqual(
      expect.arrayContaining([
        { level: 'INFO', message: `Sponsor wallet 0x83F...50FF transaction count: ${transactionCount}` },
      ])
    );
    expect(data).toEqual(
      expect.objectContaining({
        sponsorWallet: expect.any(ethers.Wallet),
        transactionCount,
      })
    );
  });

  it('returns null with error log if transaction count cannot be fetched', async () => {
    const getTransactionCountSpy = jest.spyOn(ethers.providers.JsonRpcProvider.prototype, 'getTransactionCount');
    const errorMessage = 'could not detect network (event="noNetwork", code=NETWORK_ERROR, version=providers/5.5.3)';
    getTransactionCountSpy
      .mockRejectedValueOnce(new Error(errorMessage))
      .mockRejectedValueOnce(new Error(errorMessage));

    const [logs, data] = await getSponsorWalletAndTransactionCount(airnodeWallet, provider, currentBlock, sponsor);

    expect(getTransactionCountSpy).toHaveBeenCalledTimes(2);
    expect(logs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          error: expect.objectContaining({ message: expect.stringContaining('could not detect network') }),
          level: 'ERROR',
          message: 'Failed to fetch the sponsor wallet transaction count',
        }),
      ])
    );
    expect(data).toEqual(null);
  });
});
