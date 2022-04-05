import fs from 'fs';
import path from 'path';
import { ethers } from 'ethers';
import { handler as pspHandler } from '../../handlers/psp';
import { buildAirnodeConfig, buildAirkeeperConfig } from '../config/config';
// import * as abi from '@api3/airnode-abi';
// import * as node from '@api3/airnode-node';
import * as loadConfig from '../../config';
// import { PROTOCOL_ID_PSP } from '../../constants';

describe('PSP', () => {
  const config = {
    airnodeMnemonic: 'achieve climb couple wait accident symbol spy blouse reduce foil echo label',
    privateKeys: {
      deployer: '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      manager: '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
      sponsor: '0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a',
      randomPerson: '0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a',
    },
    endpoint: {
      oisTitle: 'Currency Converter API',
      endpointName: 'convertToUSD',
    },
    templateParameters: [
      { type: 'string32', name: 'to', value: 'USD' },
      { type: 'string32', name: '_type', value: 'int256' },
      { type: 'string32', name: '_path', value: 'result' },
      { type: 'string32', name: '_times', value: '1000000' },
      { type: 'string32', name: 'from', value: 'ETH' },
    ],
    threshold: 10,
  };

  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

  const roles = {
    deployer: new ethers.Wallet(config.privateKeys.deployer).connect(provider),
    manager: new ethers.Wallet(config.privateKeys.manager).connect(provider),
    sponsor: new ethers.Wallet(config.privateKeys.sponsor).connect(provider),
    randomPerson: new ethers.Wallet(config.privateKeys.randomPerson).connect(provider),
  };

  const dapiServerAdminRoleDescription = 'DapiServer admin';
  let accessControlRegistryAbi;
  let accessControlRegistryFactory: ethers.ContractFactory;
  let accessControlRegistry: ethers.Contract;
  let airnodeProtocolAbi;
  let airnodeProtocolFactory: ethers.ContractFactory;
  let airnodeProtocol: ethers.Contract;
  let dapiServerAbi;
  let dapiServerFactory: ethers.ContractFactory;
  let dapiServer: ethers.Contract;

  beforeEach(async () => {
    // Deploy contracts
    accessControlRegistryAbi = JSON.parse(
      fs.readFileSync(path.resolve('./scripts/artifacts/AccessControlRegistry.json')).toString()
    );
    accessControlRegistryFactory = new ethers.ContractFactory(
      accessControlRegistryAbi.abi,
      accessControlRegistryAbi.bytecode,
      roles.deployer
    );
    accessControlRegistry = await accessControlRegistryFactory.deploy();
    airnodeProtocolAbi = JSON.parse(
      fs.readFileSync(path.resolve('./scripts/artifacts/AirnodeProtocol.json')).toString()
    );
    airnodeProtocolFactory = new ethers.ContractFactory(
      airnodeProtocolAbi.abi,
      airnodeProtocolAbi.bytecode,
      roles.deployer
    );
    airnodeProtocol = await airnodeProtocolFactory.deploy();

    dapiServerAbi = JSON.parse(fs.readFileSync(path.resolve('./scripts/artifacts/DapiServer.json')).toString());
    dapiServerFactory = new ethers.ContractFactory(dapiServerAbi.abi, dapiServerAbi.bytecode, roles.deployer);
    dapiServer = await dapiServerFactory.deploy(
      accessControlRegistry.address,
      dapiServerAdminRoleDescription,
      roles.manager.address,
      airnodeProtocol.address
    );
  });
  it('updates the beacon', async () => {
    jest.spyOn(loadConfig, 'loadAirnodeConfig').mockImplementationOnce(() => buildAirnodeConfig() as any);
    jest.spyOn(loadConfig, 'loadAirkeeperConfig').mockImplementationOnce(() => buildAirkeeperConfig() as any);
    const res = await pspHandler();

    expect(dapiServer).toBeDefined();
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });
});
