import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import isNil from 'lodash/isNil';
import { Id, Subscription } from '../types';
import { retryGo } from '../utils';

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
    const decodedConditions = abi.decode(subscription.conditions);
    const [decodedConditionFunctionId] = ethers.utils.defaultAbiCoder.decode(
      ['bytes32'],
      decodedConditions._conditionFunctionId
    );
    // TODO: is this really needed?
    // Airnode ABI only supports bytes32 but
    // function selector is '0x' plus 4 bytes and
    // that is why we need to ignore the trailing zeros
    conditionFunction = contract.interface.getFunction(decodedConditionFunctionId.substring(0, 2 + 4 * 2));
    conditionParameters = decodedConditions._conditionParameters;
  } catch (err) {
    const message = 'Failed to decode conditions';
    const log = node.logger.pend('ERROR', message, err as any);
    return [[log], false];
  }

  // TODO: Should we also include the condition contract address to be called in subscription.conditions
  //       and connect to that contract instead of dapiServer contract to call the conditionFunction?
  const [errorConditionFunction, result] = await retryGo(() =>
    contract
      .connect(voidSigner)
      .functions[conditionFunction.name](subscription.id, encodedFulfillmentData, conditionParameters)
  );
  if (errorConditionFunction || isNil(result)) {
    const message = 'Failed to check conditions';
    const log = node.logger.pend('ERROR', message, errorConditionFunction);
    return [[log], false];
  }
  // The result will always be ethers.Result type even if solidity function retuns a single value
  // See https://docs.ethers.io/v5/api/contract/contract/#Contract-functionsCall
  if (!result[0]) {
    const message = 'Conditions not met. Skipping update...';
    const log = node.logger.pend('WARN', message);
    return [[log], false];
  }

  return [[], true];
};
