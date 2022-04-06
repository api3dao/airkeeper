import fs from 'fs';
import path from 'path';
import { mockReadFileSync } from '../mock-utils';
import { ethers } from 'ethers';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import * as psp from '../../handlers/psp';
import { buildAirnodeConfig, buildAirkeeperConfig, buildLocalConfig } from '../config/config';
import { PROTOCOL_ID_PSP } from '../../constants';

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

    // Access control
    const managerRootRole = await accessControlRegistry.deriveRootRole(roles.manager.address);
    await accessControlRegistry
      .connect(roles.manager)
      .initializeRoleAndGrantToSender(managerRootRole, dapiServerAdminRoleDescription);

    // Wallets
    const airnodeWallet = ethers.Wallet.fromMnemonic(localConfig.airnodeMnemonic);
    const airnodePspSponsorWallet = node.evm
      .deriveSponsorWalletFromMnemonic(localConfig.airnodeMnemonic, roles.sponsor.address, PROTOCOL_ID_PSP)
      .connect(provider);
    await roles.deployer.sendTransaction({
      to: airnodePspSponsorWallet.address,
      value: ethers.utils.parseEther('1'),
    });

    // Templates
    const endpointId = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string'],
        [localConfig.endpoint.oisTitle, localConfig.endpoint.endpointName]
      )
    );
    const parameters = abi.encode(localConfig.templateParameters);
    const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, parameters]);

    // Subscriptions
    const threshold = (await dapiServer.HUNDRED_PERCENT()).div(localConfig.threshold); // Update threshold %
    const beaconUpdateSubscriptionConditionParameters = ethers.utils.defaultAbiCoder.encode(['uint256'], [threshold]);
    const beaconUpdateSubscriptionConditions = [
      {
        type: 'bytes32',
        name: '_conditionFunctionId',
        value: ethers.utils.defaultAbiCoder.encode(
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
    // const beaconUpdateSubscriptionId = ethers.utils.keccak256(
    //   ethers.utils.defaultAbiCoder.encode(
    //     ['uint256', 'address', 'bytes32', 'bytes', 'bytes', 'address', 'address', 'address', 'bytes4'],
    //     [
    //       (await provider.getNetwork()).chainId,
    //       airnodeWallet.address,
    //       templateId,
    //       '0x',
    //       encodedBeaconUpdateSubscriptionConditions,
    //       airnodeWallet.address,
    //       roles.sponsor.address,
    //       dapiServer.address, // Should this be the sponsorWallet.address instead?
    //       dapiServer.interface.getSighash('fulfillPspBeaconUpdate'),
    //     ]
    //   )
    // );
  });

  it('updates the beacon successfully', async () => {
    mockReadFileSync('config.json', JSON.stringify(airnodeConfig));
    mockReadFileSync('airkeeper.json', JSON.stringify(airkeeperConfig));
    const res = await psp.handler();

    expect(dapiServer).toBeDefined();
    expect(res).toEqual({
      statusCode: 200,
      body: JSON.stringify({ ok: true, data: { message: 'PSP beacon update execution has finished' } }),
    });
  });

  it('updates the beacon successfully with one invalid provider present', async () => {
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
        nodeSettings: { ...airnodeConfig.nodeSettings, airnodeWalletMnemonic: null },
        // chains: [],
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
