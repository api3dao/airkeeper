import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import flatMap from 'lodash/flatMap';
import { GAS_LIMIT } from '../constants';
import { EVMProviderSponsorState } from '../types';
import { retryGo } from '../utils';

export const processTransactions = async (state: EVMProviderSponsorState): Promise<node.PendingLog[]> => {
  const { airnodeWallet, contracts, gasTarget, subscriptionsBySponsorWallets } = state;

  const sponsorWalletPromises = subscriptionsBySponsorWallets.map(async ({ subscriptions, sponsorWallet }) => {
    const logs = [
      node.logger.pend(
        'INFO',
        `Processing ${subscriptions.length} subscriptions with sponsor wallet ${sponsorWallet.address.replace(
          sponsorWallet.address.substring(5, 38),
          '...'
        )}`
      ),
    ];

    // Process each subscription in serial to keep nonces in order
    for (const { subscriptionId, relayer, sponsor, fulfillFunctionId, nonce, apiValue } of subscriptions || []) {
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
        fulfillFunction = contracts['DapiServer'].interface.getFunction(fulfillFunctionId);
      } catch (error) {
        const message = 'Failed to get fulfill function';
        const log = node.logger.pend('ERROR', message, error as any);
        return [...logs, log];
      }
      const [errfulfillFunction, tx] = await retryGo<ethers.ContractTransaction>(() =>
        contracts['DapiServer']
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
        return [...logs, log];
      }
      const message = `Tx submitted: ${tx?.hash}`;
      const log = node.logger.pend('INFO', message);
      logs.push(log);
    }

    return logs;
  });

  const result = await Promise.all(sponsorWalletPromises);
  return flatMap(result);
};
