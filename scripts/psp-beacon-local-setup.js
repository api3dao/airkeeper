const fs = require('fs');
const path = require('path');
const ethers = require('ethers');
const abi = require('@api3/airnode-abi');
const { evm } = require('@api3/airnode-node');
const { PROTOCOL_IDS } = require('@api3/airnode-protocol');
const {
  AccessControlRegistry__factory: AccessControlRegistryFactory,
  AirnodeProtocol__factory: AirnodeProtocolFactory,
  DapiServer__factory: DapiServerFactory,
} = require('@api3/airnode-protocol-v1');

async function main() {
  const config = JSON.parse(fs.readFileSync(path.resolve('./scripts/config/psp-beacon-local.json')).toString());

  const provider = new ethers.providers.JsonRpcProvider(config.nodeUrl);

  const roles = {
    deployer: new ethers.Wallet(config.privateKeys.deployer).connect(provider),
    manager: new ethers.Wallet(config.privateKeys.manager).connect(provider),
    sponsor: new ethers.Wallet(config.privateKeys.sponsor).connect(provider),
    randomPerson: new ethers.Wallet(config.privateKeys.randomPerson).connect(provider),
  };

  const dapiServerAdminRoleDescription = 'DapiServer admin';

  // Deploy
  const accessControlRegistryFactory = new ethers.ContractFactory(
    AccessControlRegistryFactory.abi,
    AccessControlRegistryFactory.bytecode,
    roles.deployer
  );
  const accessControlRegistry = await accessControlRegistryFactory.deploy();
  const airnodeProtocolFactory = new ethers.ContractFactory(
    AirnodeProtocolFactory.abi,
    AirnodeProtocolFactory.bytecode,
    roles.deployer
  );
  const airnodeProtocol = await airnodeProtocolFactory.deploy();
  console.log('📒 ~ airnodeProtocol', airnodeProtocol.address);
  const dapiServerFactory = new ethers.ContractFactory(
    DapiServerFactory.abi,
    DapiServerFactory.bytecode,
    roles.deployer
  );
  const dapiServer = await dapiServerFactory.deploy(
    accessControlRegistry.address,
    dapiServerAdminRoleDescription,
    roles.manager.address,
    airnodeProtocol.address
  );
  console.log('📒 ~ dapiServer', dapiServer.address);

  // Access control
  const managerRootRole = await accessControlRegistry.deriveRootRole(roles.manager.address);
  await accessControlRegistry
    .connect(roles.manager)
    .initializeRoleAndGrantToSender(managerRootRole, dapiServerAdminRoleDescription);

  // Wallets
  const airnodeWallet = ethers.Wallet.fromMnemonic(config.airnodeMnemonic);
  console.log('👛 ~ airnodeWallet', airnodeWallet.address);
  const airnodePspSponsorWallet = evm
    .deriveSponsorWalletFromMnemonic(config.airnodeMnemonic, roles.sponsor.address, PROTOCOL_IDS.PSP)
    .connect(provider);
  console.log('👛 ~ airnodePspSponsorWallet', airnodePspSponsorWallet.address);
  await roles.deployer.sendTransaction({
    to: airnodePspSponsorWallet.address,
    value: ethers.utils.parseEther('1'),
  });

  // Templates
  const endpointId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(['string', 'string'], [config.endpoint.oisTitle, config.endpoint.endpointName])
  );
  console.log('🆔 ~ endpointId', endpointId);
  const parameters = abi.encode(config.templateParameters);
  console.log('📄 ~ encoded templateParameters', parameters);
  const templateId = ethers.utils.solidityKeccak256(['bytes32', 'bytes'], [endpointId, parameters]);
  console.log('🆔 ~ templateId', templateId);

  // Subscriptions
  const threshold = (await dapiServer.HUNDRED_PERCENT()).mul(config.threshold).div(100); // Update threshold %
  console.log('📄 ~ threshold', threshold.toString());
  const beaconUpdateSubscriptionConditionParameters = ethers.utils.defaultAbiCoder.encode(['uint256'], [threshold]);
  console.log('📄 ~ beaconUpdateSubscriptionConditionParameters', beaconUpdateSubscriptionConditionParameters);
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
  console.log('📄 ~ encoded conditions', encodedBeaconUpdateSubscriptionConditions);
  // console.log('📄 ~ decoded conditions', abi.decode(encodedBeaconUpdateSubscriptionConditions));
  await dapiServer
    .connect(roles.randomPerson)
    .registerBeaconUpdateSubscription(
      airnodeWallet.address,
      templateId,
      encodedBeaconUpdateSubscriptionConditions,
      airnodeWallet.address,
      roles.sponsor.address
    );
  const beaconUpdateSubscriptionId = ethers.utils.keccak256(
    ethers.utils.defaultAbiCoder.encode(
      ['uint256', 'address', 'bytes32', 'bytes', 'bytes', 'address', 'address', 'address', 'bytes4'],
      [
        (await provider.getNetwork()).chainId,
        airnodeWallet.address,
        templateId,
        '0x',
        encodedBeaconUpdateSubscriptionConditions,
        airnodeWallet.address,
        roles.sponsor.address,
        dapiServer.address, // Should this be the sponsorWallet.address instead?
        dapiServer.interface.getSighash('fulfillPspBeaconUpdate'),
      ]
    )
  );
  console.log('🆔 ~ beaconUpdateSubscriptionId', beaconUpdateSubscriptionId);
  console.log('👛 ~ roles.sponsor.address', roles.sponsor.address);
  console.log(
    "📄 ~ dapiServer.interface.getSighash('fulfillPspBeaconUpdate')",
    dapiServer.interface.getSighash('fulfillPspBeaconUpdate')
  );
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
