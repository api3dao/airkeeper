import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { go } from '@api3/promise-utils';
import { ethers } from 'ethers';
import { TIMEOUT_MS, RETRIES } from '../constants';
import { Id } from '../types';
import { Subscription } from '../validator';

const decodeConditions = (conditions: string, contract: ethers.Contract) => {
  const decodedConditions = abi.decode(conditions);
  const [decodedConditionFunctionId] = ethers.utils.defaultAbiCoder.decode(
    ['bytes32'],
    decodedConditions._conditionFunctionId
  );
  // Airnode ABI only supports bytes32 but function selector is '0x' plus 4 bytes and that is why
  // we need to ignore the trailing zeros instead of just using bytes4 when decoding _conditionFunctionId
  return {
    conditionFunction: contract.interface.getFunction(decodedConditionFunctionId.substring(0, 2 + 4 * 2)),
    conditionParameters: decodedConditions._conditionParameters,
  };
};

export const checkSubscriptionCondition = async (
  subscription: Id<Subscription>,
  apiValue: ethers.BigNumber,
  contract: ethers.Contract,
  voidSigner: ethers.VoidSigner
): Promise<node.LogsData<boolean>> => {
  const encodedFulfillmentData = ethers.utils.defaultAbiCoder.encode(['int256'], [apiValue]);
  let conditionFunction: ethers.utils.FunctionFragment;
  let conditionParameters: string;
  try {
    ({ conditionFunction, conditionParameters } = decodeConditions(subscription.conditions, contract));
  } catch (err) {
    const message = 'Failed to decode conditions';
    const log = utils.logger.pend('ERROR', message, err as any);
    return [[log], false];
  }

  const result = await go<ethers.utils.Result, Error>(
    () =>
      contract
        .connect(voidSigner)
        .functions[conditionFunction.name](subscription.id, encodedFulfillmentData, conditionParameters),
    {
      attemptTimeoutMs: TIMEOUT_MS,
      retries: RETRIES,
    }
  );
  if (!result.success) {
    const message = 'Failed to check conditions';
    const log = utils.logger.pend('ERROR', message, result.error);
    return [[log], false];
  }

  if (result.data === null) {
    const message = 'Failed to check conditions';
    const log = utils.logger.pend('ERROR', message);
    return [[log], false];
  }
  // The result will always be ethers.Result type even if solidity function retuns a single value
  // because we are not calling contract.METHOD_NAME but contract.functions.METHOD_NAME instead
  // See https://docs.ethers.io/v5/api/contract/contract/#Contract-functionsCall
  if (!result.data || !result.data[0]) {
    const message = 'Conditions not met. Skipping update...';
    const log = utils.logger.pend('WARN', message);
    return [[log], false];
  }

  return [[], true];
};
