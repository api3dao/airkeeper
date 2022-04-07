import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { checkSubscriptionCondition } from './check-conditions';
import { GAS_LIMIT, TIMEOUT_MS, RETRIES } from '../constants';
import { CheckedSubscription } from '../types';

export const processSponsorWallet = async (
  airnodeWallet: ethers.Wallet,
  contract: ethers.Contract,
  gasTarget: node.GasTarget,
  subscriptions: CheckedSubscription[],
  sponsorWallet: ethers.Wallet,
  voidSigner: ethers.VoidSigner,
  transactionCount: number
): Promise<node.LogsData<CheckedSubscription>[]> => {
  const logs: node.LogsData<CheckedSubscription>[] = [];

  // Keep track of nonce outside of the loop in case there is an invalid subscription and its nonce is skipped
  let nextNonce = transactionCount;

  // Process each subscription in serial to keep nonces in order
  for (const subscription of subscriptions) {
    const { id: subscriptionId, relayer, sponsor, fulfillFunctionId, apiValue } = subscription;

    // Check subscription
    const [checkSubscriptionLogs, isValid] = await checkSubscriptionCondition(
      subscription,
      apiValue,
      contract,
      voidSigner
    );
    logs.push([checkSubscriptionLogs, subscription]);

    // Skip processing if the subscription is invalid
    if (!isValid) {
      continue;
    }

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
      logs.push([[log], subscription]);
      continue;
    }
    const nonce = nextNonce++;
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
      { attemptTimeoutMs: TIMEOUT_MS, retries: RETRIES }
    );
    if (!tx.success) {
      const message = `Failed to submit transaction using wallet ${sponsorWallet.address} with nonce ${nonce}`;
      const log = utils.logger.pend('ERROR', message, tx.error);
      logs.push([[log], subscription]);
      continue;
    }
    const message = `Tx submitted: ${tx.data.hash}`;
    const log = utils.logger.pend('INFO', message);
    logs.push([[log], subscription]);
  }

  return logs;
};
