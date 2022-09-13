# Airkeeper

> A tool to update a beacon server value on a time interval

Airkeeper will fetch the value from the API (similarly to Airnode) and if a specifided condition is true then it will
update the beacon value.

There are two different lambda functions that can be used to update the beacon value:

1. `rrp-beacon-update` uses the
   [RrpBeaconServer](https://github.com/api3dao/airnode/blob/v0.4/packages/airnode-protocol/contracts/rrp/requesters/RrpBeaconServer.sol)
   contract from airnode-protocol v0.4.

   This function will fetch the API values for all triggers set in the `airkeeper.json` file, read current the beacon
   value in RrpBeaconServer and update it if the API value is not within the threshold (also defined in the
   `airkeeper.json` file).

1. `psp-beacon-update` uses the
   [DapiServer](https://github.com/api3dao/airnode/blob/991af4d69e82c1954a5c6c8e247cde8eb76101de/packages/airnode-protocol-v1/contracts/dapis/DapiServer.sol)
   contract from airnode-protocol v1. <!-- TODO: DapiServer.sol url might change -->

   This function will fetch the API values for all subscriptions in the `airkeeper.json` file, call a condition function
   on chain and update the beacon value if the condition is true.

Both functions will require a sponsor to be defined in the `airkeeper.json` file in order to derive a sponsor wallet
that will be used by Airkeeper to submit transactions. These sponsor wallets must be funded by a sponsor before
Airkeeper can start updating beacon values. The protocol ID to be used when deriving the sponsor wallet for RRP beacon
updates is `12345` and for PSP it is `2`.

## Setup

- Airkeeper configuration file will require you to copy over some parts of the Airnode's
  [`config.json`](https://github.com/api3dao/airnode/blob/v0.8.0/packages/airnode-node/config/config.example.json) file.
  For instance, `ois` and `apiCredentials` sections must be copied and pasted completely. You can refer to the
  [`airkeeper.example.json`](config/airkeeper.example.json) file for other fields that also need to be copied. Then
  `secrets.env` file can be copied from the Airnode repo and placed in the /config directory of this repo. This
  `secrets.env` file will be interpolated with the `airkeeper.json` file during runtime.

- Additional configuration specific to Airkeeper can be added to the `airkeeper.json` file. For instance `proto-psp`
  triggers, etc. <!-- TODO: add more details on each configuration property or link to docs -->

- Another requirement is to have an AWS account where these lambda functions can be deployed. Cloud provider credentials
  must be provided in the `aws.env` file and placed in the /config directory of this repo.

## Docker instructions

Use the docker image to deploy or remove an Airkeeper to and from a cloud provider such as AWS.

The docker image supports two commands.

- `deploy`: Deploys both Airkeeper lambda functions using the provided configuration files.
- `remove`: Removes both previously deployed Airkeeper lambda functions.

### Build docker image

The docker image can be built by running the following command from the root directory:

```sh
docker build . -t api3/airkeeper
```

### Deployment

The `deploy` command will create a new AWS lambda function set and a new AWS cloud scheduler. The serverless `stage` and
`region` variables are set with the following priority order:

1. CLI options
2. `aws.env` file
3. default values `stage`: 'dev' and `region`: 'us-east-1'

```sh
docker run -it --rm \
--env-file config/aws.env \
-v "$(pwd)/config:/app/config" \
api3/airkeeper:latest deploy --stage dev --region us-east-1
```

For Windows, use CMD (and not PowerShell).

```sh
docker run -it --rm ^
--env-file config/aws.env ^
-v "$(pwd)/config:/app/config" ^
api3/airkeeper:latest deploy --stage dev --region us-east-1
```

### Removal

The `remove` command will delete the previously deployed AWS lambda function and its AWS cloud scheduler.

```sh
docker run -it --rm \
--env-file config/aws.env \
-v "$(pwd)/config:/app/config" \
api3/airkeeper:latest remove --stage dev --region us-east-1
```

For Windows, use CMD (and not PowerShell).

```sh
docker run -it --rm ^
--env-file config/aws.env ^
-v "$(pwd)/config:/app/config" ^
api3/airkeeper:latest remove --stage dev --region us-east-1
```

## Development instructions

Make sure to have yarn installed, then run:

```sh
yarn install
```

### Running Airkeeper locally

Follow these steps to run Airkeeper locally:

1. Open a new terminal and start a new local ethereum node.
1. Open a new terminal and start the local 'Currency Converter API' server.
1. Deploy all required contracts (RrpBeaconServer, DapiServer, etc) and set everything up (whitelisting, sponsorship,
   etc).
1. Switch to the Airkeeper root directory and run `yarn install`.
1. Add appropriate values to the `airkeeper.json` file.
1. Finally, run `yarn sls:invoke-local:psp-beacon-update` to invoke the `psp.beaconUpdate` handler function or run
   `yarn sls:invoke-local:rrp-beacon-update` to invoke the `rrp.beaconUpdate` handler function.

### Running Airkeeper on AWS Lambda

Airkeeper is meant to be deployed to the AWS lambda service and for this you will need to add your credentials to the
`config/aws.env` file. Once done, the `export-aws-env.sh` script can be used to load them into the environment.

1. (Optional) Run `yarn sls:config` to configure the AWS credentials. You must first configure the `config/aws.env` file
   with your AWS account details and then run `source export-aws-env.sh` script to load the env vars.
1. Run `yarn sls:deploy` to deploy the Airkeeper lambda function.
1. Run `yarn sls:invoke:psp` to invoke the Airkeeper PSP beacon update lambda function.
1. Run `yarn sls:remove` to remove the Airkeeper lambda function.

## Additional considerations

### RRP beacon update

- The request sponsor account must first call `AirnodeRrp.setSponsorshipStatus(rrpBeaconServer.address, true)` to allow
  the RrpBeaconServer contract to make requests to AirnodeRrp contract.

- A `keeperSponsorWallet` needs to be derived for the sponsor-airnode pair. This is a similar process to deriving the
  sponsor wallet used by Airnode to fulfill requests but in this case the wallet derivation path is slightly different.
  This wallet needs to be funded with the native token in order for Airkeeper to use it to submit beacon updates
  requests.

- Request sponsor account must also call `RrpBeaconServer.setUpdatePermissionStatus(keeperSponsorWallet.address, true)`
  to allow the `keeperSponsorWallet` to update beacon server value.

- The template used by the RrpBeaconServer contract is expected to contain all the parameters required in the API call.

### Proto-PSP beacon update

- Current PSP beacon update implementation is a prototype; allocators, authorizers and sponsorship have been ignored.
  This is because the current implementation is not ready for production.

- Subscription and template details are expected to be provided in the `airkeeper.json` file meaning that Airkeeper will
  not fetch that information from AirnodeProtocol contract.

## Scripts

The `scripts` directory contains scripts that can be used to test the lambda functions against a local running eth node.

### Local PSP beacon update

First you need to start a local ethereum node and grab private keys of funded test accounts to add them to each account
in the psp-beacon-local.json config file. Then you need to start the local 'Currency Converter API' server.

After that you can run the following command:

- `yarn run setup:psp-local`: Deploys the DapiServer contract and registers a single subscription. Use the values
  displayed in the console to fill in the `airkeeper.json` file. Then you can run
  `yarn sls:invoke-local:psp-beacon-update` to update the beacon using PSP.

## Testing

### Unit Tests

Unit tests can then be run with:

```sh
yarn run test
```

### E2E Tests

E2E tests are defined in the `test/e2e/` folder and are identified by the `feature.ts` extension.

In order to run E2E tests, you will need to have both an Ethereum node and the "dummy" web API running. The simplest way
to accomplish this is by running:

```sh
# Start an Ethereum node and mock API
yarn run dev:eth-node
yarn run dev:api

# OR

# Start both an Ethereum node and the "dummy" web API as background processes
yarn run dev:background
```

E2E tests can then be run with:

```sh
yarn run test:e2e
```
