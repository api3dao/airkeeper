import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { GAS_LIMIT, TIMEOUT_MS, RETRIES } from '../constants';
import { ProcessableSubscription } from '../types';

export const processSponsorWallet = async (
  airnodeWallet: ethers.Wallet,
  contract: ethers.Contract,
  gasTarget: node.GasTarget,
  subscriptions: ProcessableSubscription[],
  sponsorWallet: ethers.Wallet
): Promise<node.LogsData<ProcessableSubscription>[]> => {
  const logs: node.LogsData<ProcessableSubscription>[] = [];

  // Process each subscription in serial to keep nonces in order
  for (const subscription of subscriptions.sort((a, b) => a.nonce - b.nonce)) {
    const { id: subscriptionId, relayer, sponsor, fulfillFunctionId, nonce, apiValue } = subscription;

    // Encode API value
    const encodedFulfillmentData = ethers.utils.defaultAbiCoder.encode(['int256'], [apiValue]);

    // Compute signature
    const timestamp = Math.floor(Date.now() / 1000);

    const signature = await airnodeWallet.signMessage(
      ethers.utils.arrayify(
        ethers.utils.keccak256(
          ethers.utils.solidityPack(
            ['bytes32', 'uint256', 'address'],
            [subscriptionId, timestamp, sponsorWallet.address]
          )
        )
      )
    );

    // Update beacon
    let fulfillFunction: ethers.utils.FunctionFragment;
    try {
      fulfillFunction = contract.interface.getFunction(fulfillFunctionId);
    } catch (error) {
      const message = 'Failed to get fulfill function';
      const log = utils.logger.pend('ERROR', message, error as any);
      return [...logs, [[log], subscription]];
    }
    const tx = await go<ethers.ContractTransaction, Error>(
      () =>
        contract
          .connect(sponsorWallet)
          .functions[fulfillFunction.name](
            subscriptionId,
            airnodeWallet.address,
            relayer,
            sponsor,
            timestamp,
            encodedFulfillmentData,
            signature,
            {
              gasLimit: GAS_LIMIT,
              ...gasTarget,
              nonce,
            }
          ),
      { timeoutMs: TIMEOUT_MS, retries: RETRIES }
    );
    if (!tx.success) {
      const message = `Failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${nonce}`;
      const log = utils.logger.pend('ERROR', message, tx.error);
      return [...logs, [[log], subscription]];
    }
    const message = `Tx submitted: ${tx.data.hash}`;
    const log = utils.logger.pend('INFO', message);
    logs.push([[log], subscription]);
  }

  return logs;
};
