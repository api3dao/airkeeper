import fs from 'fs';
import path from 'path';
import { mockReadFileSync } from '../mock-utils';
import { ContractFactory, Contract } from 'ethers';
import * as hre from 'hardhat';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as psp from '../../handlers/psp';
import * as api from '../../api/call-api';
import * as config from '../../config';
import { buildAirnodeConfig, buildAirkeeperConfig, buildLocalConfig } from '../config/config';
import { PROTOCOL_ID_PSP } from '../../constants';

// Jest version 27 has a bug where jest.setTimeout does not work correctly inside describe or test blocks
// https://github.com/facebook/jest/issues/11607
jest.setTimeout(30_000);

describe('PSP', () => {
  process.env = Object.assign(process.env, {
    CLOUD_PROVIDER: 'local',
    STAGE: 'dev',
  });

  const airnodeConfig = buildAirnodeConfig();
  const airkeeperConfig = buildAirkeeperConfig();
  const localConfig = buildLocalConfig();

  const provider = new hre.ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

  const roles = {
    deployer: new hre.ethers.Wallet(localConfig.privateKeys.deployer).connect(provider),
    manager: new hre.ethers.Wallet(localConfig.privateKeys.manager).connect(provider),
    sponsor: new hre.ethers.Wallet(localConfig.privateKeys.sponsor).connect(provider),
    randomPerson: new hre.ethers.Wallet(localConfig.privateKeys.randomPerson).connect(provider),
  };

  const dapiServerAdminRoleDescription = 'DapiServer admin';
  let accessControlRegistryAbi;
  let accessControlRegistryFactory: ContractFactory;
  let accessControlRegistry: Contract;
  let airnodeProtocolAbi;
  let airnodeProtocolFactory: ContractFactory;
  let airnodeProtocol: Contract;
  let dapiServerAbi;
  let dapiServerFactory: ContractFactory;
  let dapiServer: Contract;

  beforeEach(async () => {
    //Reset the local hardhat network state for each test to keep the deployed Airnode and DapiServer contract addresses
    //the same as the config files
    await hre.network.provider.send('hardhat_reset');

    jest.restoreAllMocks();

    // Deploy contracts
    accessControlRegistryAbi = JSON.parse(
      fs.readFileSync(path.resolve('./scripts/artifacts/AccessControlRegistry.json')).toString()
    );
    accessControlRegistryFactory = new hre.ethers.ContractFactory(
      accessControlRegistryAbi.abi,
      accessControlRegistryAbi.bytecode,
      roles.deployer
    );
    accessControlRegistry = await accessControlRegistryFactory.deploy();
    airnodeProtocolAbi = JSON.parse(
      fs.readFileSync(path.resolve('./scripts/artifacts/AirnodeProtocol.json')).toString()
    );
    airnodeProtocolFactory = new hre.ethers.ContractFactory(
      airnodeProtocolAbi.abi,
      airnodeProtocolAbi.bytecode,
      roles.deployer
    );
    airnodeProtocol = await airnodeProtocolFactory.deploy();

    dapiServerAbi = JSON.parse(fs.readFileSync(path.resolve('./scripts/artifacts/DapiServer.json')).toString());
    dapiServerFactory = new hre.ethers.ContractFactory(dapiServerAbi.abi, dapiServerAbi.bytecode, roles.deployer);
    dapiServer = await dapiServerFactory.deploy(
      accessControlRegistry.address,
      dapiServerAdminRoleDescription,
      roles.manager.address,
      airnodeProtocol.address
    );

    // Access control
    const managerRootRole = await accessControlRegistry.deriveRootRole(roles.manager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(managerRootRole, dapiServerAdminRoleDescription);

    // Wallets
    const airnodeWallet = hre.ethers.Wallet.fromMnemonic(localConfig.airnodeMnemonic);
    const airnodePspSponsorWallet = node.evm
      .deriveSponsorWalletFromMnemonic(localConfig.airnodeMnemonic, roles.sponsor.address, PROTOCOL_ID_PSP)
      .connect(provider);
    await roles.deployer.sendTransaction({
      to: airnodePspSponsorWallet.address,
      value: hre.ethers.utils.parseEther('1'),
    });

    // Templates
    const endpointId = hre.ethers.utils.keccak256(
      hre.ethers.utils.defaultAbiCoder.encode(
        ['string', 'string'],
        [localConfig.endpoint.oisTitle, localConfig.endpoint.endpointName]
      )
    );
    const parameters = abi.encode(localConfig.templateParameters);
    const templateId = hre.ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, parameters]);

    // Subscriptions
    const threshold = (await dapiServer.HUNDRED_PERCENT()).div(localConfig.threshold); // Update threshold %
    const beaconUpdateSubscriptionConditionParameters = hre.ethers.utils.defaultAbiCoder.encode(
      ['uint256'],
      [threshold]
    );
    const beaconUpdateSubscriptionConditions = [
      {
        type: 'bytes32',
        name: '_conditionFunctionId',
        value: hre.ethers.utils.defaultAbiCoder.encode(
          ['bytes4'],
          [dapiServer.interface.getSighash('conditionPspBeaconUpdate')]
        ),
      },
      { type: 'bytes', name: '_conditionParameters', value: beaconUpdateSubscriptionConditionParameters },
    ];
    const encodedBeaconUpdateSubscriptionConditions = abi.encode(beaconUpdateSubscriptionConditions);
    await dapiServer
      .connect(roles.randomPerson)
      .registerBeaconUpdateSubscription(
        airnodeWallet.address,
        templateId,
        encodedBeaconUpdateSubscriptionConditions,
        airnodeWallet.address,
        roles.sponsor.address
      );
  });

  it('updates the beacon successfully', async () => {
    jest
      .spyOn(config, 'loadAirnodeConfig')
      .mockImplementationOnce(() => airnodeConfig as any)
      .mockImplementationOnce(() => airnodeConfig as any);
    jest.spyOn(config, 'loadAirkeeperConfig').mockImplementationOnce(() => airkeeperConfig as any);
    const res = await psp.handler();

    const beaconId = await dapiServer.subscriptionIdToBeaconId(
      '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e'
    );
    const voidSigner = new hre.ethers.VoidSigner(hre.ethers.constants.AddressZero, provider);
    const dapiServerResponse = await dapiServer.connect(voidSigner).readWithDataPointId(beaconId);

    expect(dapiServerResponse[0].toNumber()).toEqual(723.39202 * 1000000);
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('updates the beacon successfully after retrying a failed api call', async () => {
    jest
      .spyOn(config, 'loadAirnodeConfig')
      .mockImplementationOnce(() => airnodeConfig as any)
      .mockImplementationOnce(() => airnodeConfig as any);
    jest.spyOn(config, 'loadAirkeeperConfig').mockImplementationOnce(() => airkeeperConfig as any);

    const callApiSpy = jest.spyOn(api, 'callApi');
    callApiSpy.mockRejectedValueOnce(new Error('Api call failed'));

    const res = await psp.handler();

    const beaconId = await dapiServer.subscriptionIdToBeaconId(
      '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e'
    );
    const voidSigner = new hre.ethers.VoidSigner(hre.ethers.constants.AddressZero, provider);
    const dapiServerResponse = await dapiServer.connect(voidSigner).readWithDataPointId(beaconId);

    expect(dapiServerResponse[0].toNumber()).toEqual(723.39202 * 1000000);
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('updates the beacon successfully with one invalid provider present', async () => {
    jest
      .spyOn(config, 'loadAirnodeConfig')
      .mockImplementation(
        () =>
          ({
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
          } as any)
      )
      .mockImplementationOnce(
        () =>
          ({
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
          } as any)
      );
    jest.spyOn(config, 'loadAirkeeperConfig').mockImplementationOnce(() => airkeeperConfig);

    const res = await psp.handler();

    const beaconId = await dapiServer.subscriptionIdToBeaconId(
      '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e'
    );
    const voidSigner = new hre.ethers.VoidSigner(hre.ethers.constants.AddressZero, provider);
    const dapiServerResponse = await dapiServer.connect(voidSigner).readWithDataPointId(beaconId);

    expect(dapiServerResponse[0].toNumber()).toEqual(723.39202 * 1000000);
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('updates the beacon successfully with one invalid subscription present', async () => {
    jest
      .spyOn(config, 'loadAirnodeConfig')
      .mockImplementationOnce(() => airnodeConfig as any)
      .mockImplementationOnce(() => airnodeConfig as any);
    jest.spyOn(config, 'loadAirkeeperConfig').mockImplementationOnce(() => ({
      ...airkeeperConfig,
      subscriptions: {
        '0x6efac1aca63fe97cbb96498d49e600397eb118956bc84a600e08f6eaa95a882e': {
          ...Object.values(airkeeperConfig.subscriptions)[0],
          fulfillFunctionId: '0xinvalid',
        },
        ...airkeeperConfig.subscriptions,
      },
    }));

    const res = await psp.handler();

    const beaconId = await dapiServer.subscriptionIdToBeaconId(
      '0xc1ed31de05a9aa74410c24bccd6aa40235006f9063f1c65d47401e97ad04560e'
    );
    const voidSigner = new hre.ethers.VoidSigner(hre.ethers.constants.AddressZero, provider);
    const dapiServerResponse = await dapiServer.connect(voidSigner).readWithDataPointId(beaconId);

    expect(dapiServerResponse[0].toNumber()).toEqual(723.39202 * 1000000);
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
        nodeSettings: { ...airnodeConfig.nodeSettings, airnodeWalletMnemonic: null },
      })
    );
    mockReadFileSync('airkeeper.json', JSON.stringify(airkeeperConfig));
    await expect(psp.handler).rejects.toThrow('Invalid Airnode configuration file');
  });

  it('throws on invalid airkeeper config', async () => {
    mockReadFileSync('config.json', JSON.stringify(airnodeConfig));
    mockReadFileSync('airkeeper.json', JSON.stringify({ ...airkeeperConfig, airnodeAddress: null }));
    await expect(psp.handler).rejects.toThrow('Invalid Airkeeper configuration file');
  });
});
