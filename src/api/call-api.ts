import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { Config } from '../types';
import { Endpoint } from '../validator';

const wait = (ms: number) => new Promise((res) => setTimeout(res, ms));
// const maybeFail = (successProbability: number, result: string, error: Error) =>
//   new Promise((res, rej) => (Math.random() < successProbability ? res(result) : rej(error)));

// const maybeFailingOperation = async () => {
//   return maybeFail(0.1, 'API call succeeded!', new Error('API call failed!'));
// };

export const callApi = async (
  config: Config,
  endpoint: Endpoint,
  parameters: node.ApiCallParameters
): Promise<node.LogsData<ethers.BigNumber | null>> => {
  console.log('---------> Attempting to fetch:', parameters['from']);
  console.log('---------> timestamp: ', Date.now().toString());
  if (parameters['from'] === 'API3') {
    const min = 75;
    const max = 125;
    const sleepMs = Math.floor(Math.random() * (max - min + 1)) + min;
    console.log('---------> sleepMs', sleepMs);
    await wait(sleepMs);

    // await wait(1100);

    console.log('---------> ABOUT TO FAIL:', Date.now().toString());
    //console.log('---------> RESULT:', await maybeFailingOperation());
    // return Promise.reject(new Error('Error from API3'));
    throw new Error('Error from API3');
  }

  // Note: airnodeAddress, endpointId, id are not used in callApi verification, but are required by the node.AggregatedApiCall type
  const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic);
  const airnodeAddress = (
    config.airnodeXpub
      ? ethers.utils.HDNode.fromExtendedKey(config.airnodeXpub).derivePath('0/0')
      : airnodeHDNode.derivePath(ethers.utils.defaultPath)
  ).address;
  const endpointId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['string', 'string'], [endpoint.oisTitle, endpoint.endpointName])
  );
  const id = utils.randomHexString(16);

  const [logs, apiCallResponse] = await node.handlers.callApi({
    config,
    aggregatedApiCall: { type: 'http-gateway', airnodeAddress, endpointId, id, parameters, ...endpoint },
  });
  if (!apiCallResponse.success) {
    return [logs, null];
  }

  const parsedData = JSON.parse(apiCallResponse.value);
  // const decodedValue = ethers.utils.defaultAbiCoder.decode(['uint256'], parsedData.encodedValue);
  const [apiValue] = parsedData.values;
  const messageApiValue = `API value: ${apiValue}`;
  const logApiValue = utils.logger.pend('DEBUG', messageApiValue);
  return [[...logs, logApiValue], ethers.BigNumber.from(apiValue)];
};
