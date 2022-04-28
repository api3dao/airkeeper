import { mockReadFileSync } from '../mock-utils';
import * as hre from 'hardhat';
import * as abi from '@api3/airnode-abi';
import * as node from '@api3/airnode-node';
import { ethers } from 'ethers';
import {
  AccessControlRegistry__factory as AccessControlRegistryFactory,
  AirnodeProtocol__factory as AirnodeProtocolFactory,
  DapiServer__factory as DapiServerFactory,
} from '@api3/airnode-protocol-v1';
import * as psp from '../../src/handlers/psp';
import * as api from '../../src/api/call-api';
import * as configModule from '../../src/config';
import { buildConfig, buildLocalConfigETH, buildLocalConfigBTC } from '../config/config';
import { PROTOCOL_ID_PSP } from '../../src/constants';

// Jest version 27 has a bug where jest.setTimeout does not work correctly inside describe or test blocks
// https://github.com/facebook/jest/issues/11607
jest.setTimeout(30_000);

const dapiServerAdminRoleDescription = 'DapiServer admin';
const subscriptionIdBTC = '0xb4c3cea3b78c384eb4409df1497bb2f1fd872f1928a218f8907c38fe0d66ffea';
const provider = new ethers.providers.JsonRpcProvider('http://127.0.0.1:8545');

process.env = Object.assign(process.env, {
  CLOUD_PROVIDER: 'local',
  STAGE: 'dev',
});

const config = buildConfig();
const localConfigETH = buildLocalConfigETH();

const roles = {
  deployer: new ethers.Wallet(localConfigETH.privateKeys.deployer).connect(provider),
  manager: new ethers.Wallet(localConfigETH.privateKeys.manager).connect(provider),
  sponsor: new ethers.Wallet(localConfigETH.privateKeys.sponsor).connect(provider),
  randomPerson: new ethers.Wallet(localConfigETH.privateKeys.randomPerson).connect(provider),
};

const readBeaconValue = async (airnodeAddress: string, templateId: string, dapiServer: ethers.Contract) => {
  const voidSigner = new ethers.VoidSigner(ethers.constants.AddressZero, provider);
  const beaconId = ethers.utils.keccak256(
    ethers.utils.solidityPack(['address', 'bytes32'], [airnodeAddress, templateId])
  );

  try {
    return await dapiServer.connect(voidSigner).readDataFeedValueWithId(beaconId);
  } catch (e) {
    return null;
  }
};

describe('PSP', () => {
  let accessControlRegistryFactory: ethers.ContractFactory;
  let accessControlRegistry: ethers.Contract;
  let airnodeProtocolFactory: ethers.ContractFactory;
  let airnodeProtocol: ethers.Contract;
  let dapiServerFactory: ethers.ContractFactory;
  let dapiServer: ethers.Contract;
  let templateIdETH: string;
  let templateIdBTC: string;

  beforeEach(async () => {
    // Reset the local hardhat network state for each test to keep the deployed Airnode and DapiServer contract addresses
    // the same as the config files
    await hre.network.provider.send('hardhat_reset');

    jest.restoreAllMocks();

    // Deploy contracts
    accessControlRegistryFactory = new ethers.ContractFactory(
      AccessControlRegistryFactory.abi,
      AccessControlRegistryFactory.bytecode,
      roles.deployer
    );
    accessControlRegistry = await accessControlRegistryFactory.deploy();

    airnodeProtocolFactory = new ethers.ContractFactory(
      AirnodeProtocolFactory.abi,
      AirnodeProtocolFactory.bytecode,
      roles.deployer
    );
    airnodeProtocol = await airnodeProtocolFactory.deploy();

    dapiServerFactory = new ethers.ContractFactory(DapiServerFactory.abi, DapiServerFactory.bytecode, roles.deployer);
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
    const airnodeWallet = ethers.Wallet.fromMnemonic(localConfigETH.airnodeMnemonic);
    const airnodePspSponsorWallet = node.evm
      .deriveSponsorWalletFromMnemonic(localConfigETH.airnodeMnemonic, roles.sponsor.address, PROTOCOL_ID_PSP)
      .connect(provider);
    await roles.deployer.sendTransaction({
      to: airnodePspSponsorWallet.address,
      value: ethers.utils.parseEther('1'),
    });

    // Setup ETH Subscription
    // Templates
    const endpointIdETH = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string'],
        [localConfigETH.endpoint.oisTitle, localConfigETH.endpoint.endpointName]
      )
    );
    const parametersETH = abi.encode(localConfigETH.templateParameters);
    templateIdETH = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointIdETH, parametersETH]);

    // Subscriptions
    const thresholdETH = (await dapiServer.HUNDRED_PERCENT()).div(localConfigETH.threshold); // Update threshold %
    const beaconUpdateSubscriptionConditionParametersETH = ethers.utils.defaultAbiCoder.encode(
      ['uint256'],
      [thresholdETH]
    );
    const beaconUpdateSubscriptionConditionsETH = [
      {
        type: 'bytes32',
        name: '_conditionFunctionId',
        value: ethers.utils.defaultAbiCoder.encode(
          ['bytes4'],
          [dapiServer.interface.getSighash('conditionPspBeaconUpdate')]
        ),
      },
      { type: 'bytes', name: '_conditionParameters', value: beaconUpdateSubscriptionConditionParametersETH },
    ];
    const encodedBeaconUpdateSubscriptionConditionsETH = abi.encode(beaconUpdateSubscriptionConditionsETH);
    await dapiServer
      .connect(roles.randomPerson)
      .registerBeaconUpdateSubscription(
        airnodeWallet.address,
        templateIdETH,
        encodedBeaconUpdateSubscriptionConditionsETH,
        airnodeWallet.address,
        roles.sponsor.address
      );

    // Setup BTC Subscription
    const localConfigBTC = buildLocalConfigBTC();
    // Templates
    const endpointIdBTC = ethers.utils.keccak256(
      ethers.utils.defaultAbiCoder.encode(
        ['string', 'string'],
        [localConfigBTC.endpoint.oisTitle, localConfigBTC.endpoint.endpointName]
      )
    );
    const parametersBTC = abi.encode(localConfigBTC.templateParameters);
    templateIdBTC = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointIdBTC, parametersBTC]);

    // Subscriptions
    const thresholdBTC = (await dapiServer.HUNDRED_PERCENT()).div(localConfigBTC.threshold); // Update threshold %
    const beaconUpdateSubscriptionConditionParameters2 = ethers.utils.defaultAbiCoder.encode(
      ['uint256'],
      [thresholdBTC]
    );
    const beaconUpdateSubscriptionConditionsBTC = [
      {
        type: 'bytes32',
        name: '_conditionFunctionId',
        value: ethers.utils.defaultAbiCoder.encode(
          ['bytes4'],
          [dapiServer.interface.getSighash('conditionPspBeaconUpdate')]
        ),
      },
      { type: 'bytes', name: '_conditionParameters', value: beaconUpdateSubscriptionConditionParameters2 },
    ];
    const encodedBeaconUpdateSubscriptionConditionsBTC = abi.encode(beaconUpdateSubscriptionConditionsBTC);
    await dapiServer
      .connect(roles.randomPerson)
      .registerBeaconUpdateSubscription(
        airnodeWallet.address,
        templateIdBTC,
        encodedBeaconUpdateSubscriptionConditionsBTC,
        airnodeWallet.address,
        roles.sponsor.address
      );
  });

  it('updates the beacons successfully', async () => {
    jest.spyOn(configModule, 'loadConfig').mockImplementation(() => config as any);
    await psp.handler({} as any, {} as any, {} as any);

    const beaconValueETH = await readBeaconValue(config.airnodeAddress, templateIdETH, dapiServer);
    const beaconValueBTC = await readBeaconValue(config.airnodeAddress, templateIdBTC, dapiServer);

    expect(beaconValueETH).toEqual(ethers.BigNumber.from(723.39202 * 1_000_000));
    expect(beaconValueBTC).toEqual(ethers.BigNumber.from(41091.12345 * 1_000_000));
  });

  it('updates the beacons successfully after retrying a failed api call', async () => {
    jest.spyOn(configModule, 'loadConfig').mockImplementation(() => config as any);

    const callApiSpy = jest.spyOn(api, 'callApi');
    callApiSpy.mockRejectedValueOnce(new Error('Api call failed'));

    await psp.handler({} as any, {} as any, {} as any);

    const beaconValueETH = await readBeaconValue(config.airnodeAddress, templateIdETH, dapiServer);
    const beaconValueBTC = await readBeaconValue(config.airnodeAddress, templateIdBTC, dapiServer);

    expect(beaconValueETH).toEqual(ethers.BigNumber.from(723.39202 * 1_000_000));
    expect(beaconValueBTC).toEqual(ethers.BigNumber.from(41091.12345 * 1_000_000));
  });

  it('updates the beacons successfully with one invalid provider present', async () => {
    jest.spyOn(configModule, 'loadConfig').mockImplementation(
      () =>
        ({
          ...config,
          chains: [
            ...config.chains,
            {
              ...config.chains[0],
              providers: {
                ...config.chains[0].providers,
                invalidProvider: {
                  url: 'http://invalid',
                },
              },
            },
          ],
        } as any)
    );

    await psp.handler({} as any, {} as any, {} as any);

    const beaconValueETH = await readBeaconValue(config.airnodeAddress, templateIdETH, dapiServer);
    const beaconValueBTC = await readBeaconValue(config.airnodeAddress, templateIdBTC, dapiServer);

    expect(beaconValueETH).toEqual(ethers.BigNumber.from(723.39202 * 1_000_000));
    expect(beaconValueBTC).toEqual(ethers.BigNumber.from(41091.12345 * 1_000_000));
  });

  it('updates the beacon successfully with one invalid subscription present', async () => {
    jest.spyOn(configModule, 'loadConfig').mockImplementation(
      () =>
        ({
          ...config,
          subscriptions: {
            ...config.subscriptions,
            [subscriptionIdBTC]: {
              ...config.subscriptions[subscriptionIdBTC],
              fulfillFunctionId: '0x206b48fa', // invalid fulfillFunctionId
            },
          },
        } as any)
    );

    await psp.handler({} as any, {} as any, {} as any);

    const beaconValueETH = await readBeaconValue(config.airnodeAddress, templateIdETH, dapiServer);
    const beaconValueBTC = await readBeaconValue(config.airnodeAddress, templateIdBTC, dapiServer);

    expect(beaconValueETH).toEqual(ethers.BigNumber.from(723.39202 * 1_000_000));
    expect(beaconValueBTC).toEqual(null);
  });

  it('throws on invalid config', async () => {
    mockReadFileSync(
      'airkeeper.json',
      JSON.stringify({
        ...config,
        nodeSettings: { ...config.nodeSettings, airnodeWalletMnemonic: null },
      })
    );
    await expect(psp.handler).rejects.toThrow('Invalid Airkeeper configuration file');
  });
});
