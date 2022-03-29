import * as node from '@api3/airnode-node';
import * as utils from '@api3/airnode-utilities';
import { ethers } from 'ethers';
import { Config } from '../types';
import { Endpoint } from '../validator';

export const callApi = async (
  config: Config,
  endpoint: Endpoint,
  parameters: node.ApiCallParameters
): Promise<node.LogsData<ethers.BigNumber | null>> => {
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
  const [apiValue] = parsedData.values;
  const messageApiValue = `API value: ${apiValue}`;
  const logApiValue = utils.logger.pend('DEBUG', messageApiValue);
  return [[...logs, logApiValue], ethers.BigNumber.from(apiValue)];
};
