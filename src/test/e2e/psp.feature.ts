import fs from 'fs';
import path from 'path';
import { mockReadFileSync } from '../mock-utils';
import { ethers } from 'ethers';
import * as psp from '../../handlers/psp';
import { buildAirnodeConfig, buildAirkeeperConfig, buildLocalConfig } from '../config/config';
// import * as abi from '@api3/airnode-abi';
// import * as node from '@api3/airnode-node';
// import * as loadConfig from '../../config';
// import { PROTOCOL_ID_PSP } from '../../constants';

describe('PSP', () => {
  beforeEach(() => jest.restoreAllMocks());

  const airnodeConfig = buildAirnodeConfig();
  const airkeeperConfig = buildAirkeeperConfig();
  const localConfig = buildLocalConfig();

  const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

  const roles = {
    deployer: new ethers.Wallet(localConfig.privateKeys.deployer).connect(provider),
    manager: new ethers.Wallet(localConfig.privateKeys.manager).connect(provider),
    sponsor: new ethers.Wallet(localConfig.privateKeys.sponsor).connect(provider),
    randomPerson: new ethers.Wallet(localConfig.privateKeys.randomPerson).connect(provider),
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

  it('updates the beacon successfully', async () => {
    // jest.spyOn(loadConfig, 'loadAirnodeConfig').mockImplementationOnce(() => airnodeConfig as any);
    // jest.spyOn(loadConfig, 'loadAirkeeperConfig').mockImplementationOnce(() => airkeeperConfig as any);
    mockReadFileSync('config.json', JSON.stringify(airnodeConfig));
    // jest.requireActual('fs');
    mockReadFileSync('airkeeper.json', JSON.stringify(airkeeperConfig));
    const res = await psp.handler();

    expect(dapiServer).toBeDefined();
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('updates the beacon successfully with one invalid provider present', async () => {
    // jest.spyOn(loadConfig, 'loadAirnodeConfig').mockImplementationOnce(
    //   () =>
    //     ({
    //       ...airnodeConfig,
    //       chains: [
    //         ...airnodeConfig.chains,
    //         {
    //           ...airnodeConfig.chains[0],
    //           providers: {
    //             ...airnodeConfig.chains[0].providers,
    //             invalidProvider: {
    //               url: 'http://invalid',
    //             },
    //           },
    //         },
    //       ],
    //     } as any)
    // );
    // jest.spyOn(loadConfig, 'loadAirkeeperConfig').mockImplementationOnce(() => airkeeperConfig as any);
    mockReadFileSync(
      'config.json',
      JSON.stringify({
        ...airnodeConfig,
        chains: [
          ...airnodeConfig.chains,
          {
            ...airnodeConfig.chains[0],
            providers: {
              ...airnodeConfig.chains[0].providers,
              invalidProvider: {
                url: 'http://invalid',
              },
            },
          },
        ],
      })
    );
    mockReadFileSync('airkeeper.json', JSON.stringify(airkeeperConfig));
    const res = await psp.handler();

    expect(dapiServer).toBeDefined();
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('throws on invalid airnode config', async () => {
    mockReadFileSync(
      'config.json',
      JSON.stringify({
        ...airnodeConfig,

        chains: [],
      })
    );
    mockReadFileSync('airkeeper.json', JSON.stringify(airkeeperConfig));
    await expect(psp.handler).rejects.toThrow();
  });

  it('throws on invalid airkeeper config', async () => {
    mockReadFileSync('config.json', JSON.stringify(airnodeConfig));
    mockReadFileSync('airkeeper.json', JSON.stringify({ ...airkeeperConfig, airnodeAddress: null }));
    await expect(psp.handler).rejects.toThrow();
  });
});
