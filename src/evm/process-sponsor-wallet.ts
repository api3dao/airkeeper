import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import { GAS_LIMIT } from '../constants';
import { ProcessableSubscription } from '../types';
import { retryGo } from '../utils';

export const processSponsorWallet = async (
  airnodeWallet: ethers.Wallet,
  contract: ethers.Contract,
  gasTarget: node.GasTarget,
  subscriptions: ProcessableSubscription[],
  sponsorWallet: ethers.Wallet
): Promise<node.LogsData<ProcessableSubscription>[]> => {
  const logs: node.LogsData<ProcessableSubscription>[] = [];

  // Process each subscription in serial to keep nonces in order
  for (const subscription of subscriptions.sort((a, b) => a.nonce - b.nonce) || []) {
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
      const log = node.logger.pend('ERROR', message, error as any);
      return [...logs, [[log], subscription]];
    }
    const [errfulfillFunction, tx] = await retryGo<ethers.ContractTransaction>(() =>
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
        )
    );
    if (errfulfillFunction) {
      const message = `Failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${nonce}`;
      const log = node.logger.pend('ERROR', message, errfulfillFunction);
      return [...logs, [[log], subscription]];
    }
    const message = `Tx submitted: ${tx?.hash}`;
    const log = node.logger.pend('INFO', message);
    logs.push([[log], subscription]);
  }

  return logs;
};