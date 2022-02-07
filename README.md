# Airkeeper

> A tool to update a beacon server value on a time interval

This project is basically a makeshift version of the PSP protocol and it will be used to trigger beacon values updates on a fixed time interval of 1 minute.

Airkeeper will fetch the value from the API (similarly to Airnode) and will also read the current beacon value onchain from the beacon contract state. If the delta between the two values is greater than a threshold, the beacon value will be updated onchain by submitting an RRP request that will be fulfilled by the Airnode.

## Setup

- Airkeeper will require a configuration file that matches the one being used by the Airnode that should be used to update the beacon server value. You can just copy over the `config.json` file from the Airnode repo and put it in the /config directory of this repo. Same goes for `secrets.env` file from the Airnode repo. Examples of these two files can be found in the /config directory of this repo.

- Airkeeper will also require an additional configuration file that will be merged with the one mentioned above and it will contain the configuration specific to Airkeeper. This file needs to be called `airkeeper.json` and you can find an example in the /config directory of this repo.

- Another requirement is to have an AWS account and cloud provider credentials must be provided in the `aws.env` file. An example of this file can be found in the /config directory of this repo.

## Docker instructions

Use the docker image to deploy or remove an Airkeeper to and from a cloud provider such as AWS.

The docker image supports two commands.

- `deploy`: Deploys an Airkeeper using configuration files.
- `remove`: Removes an Airkeeper previously deployed.

### Build docker image

You can build the docker image by running the following command from the root directory:

```
docker build . -t api3/airkeeper
```

### deploy command

The `deploy` command will create a new AWS lambda function and a new AWS cloud scheduler.

```sh
docker run -it --rm \
--env-file config/aws.env \
--env COMMAND=deploy \
-v "$(pwd)/config:/airkeeper/config" \
api3/airkeeper:latest
```

For Windows, use CMD (and not PowerShell).

```sh
docker run -it --rm ^
--env-file config/aws.env ^
--env COMMAND=deploy ^
-v "$(pwd)/config:/airkeeper/config" ^
api3/airkeeper:latest
```

### remove command

The `remove` command will delete the previously deployed AWS lambda function and its AWS cloud scheduler.

```sh
docker run -it --rm \
--env-file config/aws.env \
--env COMMAND=remove \
-v "$(pwd)/config:/airkeeper/config" \
api3/airkeeper:latest
```

For Windows, use CMD (and not PowerShell).

```sh
docker run -it --rm ^
--env-file config/aws.env ^
--env COMMAND=remove ^
-v "$(pwd)/config:/airkeeper/config" ^
api3/airkeeper:latest
```

## Manual instructions

Make sure to have the following dependencies installed:

- npm
- serverless framework (https://www.serverless.com/framework/docs/getting-started)

### Running Airkeeper locally

In order to run Airkeeper with sample configuration files locally, you will need to follow these steps:

1. Open a new terminal and navigate to the root directory of the Airnode repo.
2. Run `yarn run bootstrap && yarn build` to build the project.
3. Add the `config.json` and `secrets.env` files to the packages/airnode-node/config directory.
4. Run `yarn run dev:background` to start a local ethereum node and a sample REST API.
5. Run `yarn run dev:eth-deploy` to deploy and configure the required contracts.
6. Switch to the Airkeeper root directory and run `npm install`
7. Finally run `npm run sls:invoke-local` to invoke the updateBeacon function.

### Running Airkeeper on AWS Lambda

Airkeeper is meant to be deployed to AWS lambda service and for this you will need to add your credentials to the `config/aws.env` file. Then, you can use the `export-aws-env.sh` script to load them into the environment.

1. (Optional) Run `npm run sls:config` to configure the AWS credentials. You must first configure the `config/aws.env` file with your AWS account details and then run `source export-aws-env.sh` script to load the env vars.
2. Run `npm run sls:deploy` to deploy the Airkeeper lambda function.
3. Run `npm run sls:invoke` to invoke the Airkeeper lambda function.
4. Run `npm run sls:remove` to remove the Airkeeper lambda function.

## Additional considerations

- Request sponsor account must first call `AirnodeRrp.setSponsorshipStatus(rrpBeaconServer.address, true)` to allow the RrpBeaconServer contract to make requests to AirnodeRrp contract.

- A `keeperSponsorWallet` needs to be derived for the sponsor-airnode pair. This is a similar process to deriving the sponsor wallet used by Airnode to fulfill requests but in this case the wallet derivation path is slightly different. This wallet needs to be funded with ETH in order for Airkeeper to use it to submit beacon updates requests.

- Request sponsor account must also call `RrpBeaconServer.setUpdatePermissionStatus(keeperSponsorWallet.address, true)` to allow the `keeperSponsorWallet` to update beacon server value.

- The template used by the RrpBeaconServer contract is expected to contain all the parameters required in the API call.
