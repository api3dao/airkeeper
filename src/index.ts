import * as adapter from "@api3/airnode-adapter";
import * as node from "@api3/airnode-node";
import { AirnodeRrpFactory } from "@api3/airnode-protocol";
import * as dotenv from "dotenv";
import * as ethers from "ethers";
import * as fs from "fs";
import { each, isEmpty, isNil, merge } from "lodash";
import * as path from "path";
//TODO: remove and use @api3/airnode-node import
import { safeDecode } from "./node/abi-encoding";
//TODO: remove and use @api3/airnode-node import
import { buildEVMProvider } from "./node/evm-provider";
//TODO: remove and use @api3/airnode-node import
import { removeKey, removeKeys } from "./node/object-utils";
//TODO: remove and use @api3/airnode-node import
import { getReservedParameters, RESERVED_PARAMETERS } from "./node/parameters";
//TODO: remove and use @api3/airnode-node import
import {
  deriveSponsorWallet,
  deriveWalletPathFromSponsorAddress,
} from "./node/wallet";
//TODO: remove and use "@api3/airnode-protocol" import;
import RrpBeaconServer from "./node/RrpBeaconServer.json";
import { Config } from "./types";

export const handler = async (event: any = {}): Promise<any> => {
  // **************************************************************************
  // 1. Load config (this file must be the same as the one used by the node)
  // **************************************************************************
  const secretsPath = path.resolve(`${__dirname}/../config/secrets.env`);
  const secrets = dotenv.parse(fs.readFileSync(secretsPath));
  const nodeConfigPath = path.resolve(`${__dirname}/../config/airnode.json`);
  const nodeConfig = node.config.parseConfig(nodeConfigPath, secrets);
  const keeperConfig = loadAirkeeperConfig();
  const config = merge(nodeConfig, keeperConfig);

  const { chains, nodeSettings, triggers, ois, apiCredentials } = config;
  if (isEmpty(chains)) {
    throw new Error(
      "One or more chains must be defined in the provided config"
    );
  }
  chains
    .filter((chain) => chain.type === "evm")
    .forEach(async (chain) => {
      each(chain.providers, async (_, providerName) => {
        // **************************************************************************
        // 2. Init provider, AirnodeRrp, RrpBeaconServer and Airnode wallet
        // **************************************************************************
        const chainProviderUrl = chain.providers[providerName].url || "";
        const provider = buildEVMProvider(chainProviderUrl, chain.id);

        const airnodeRrp = AirnodeRrpFactory.connect(
          chain.contracts.AirnodeRrp,
          provider
        );

        // TODO: use factory class to create contract instead
        // const rrpBeaconServer = RrpBeaconServerFactory.connect(
        //   (chain as any).contracts.RrpBeaconServer, // TODO: fix ChainConfig type
        //   provider
        // );
        const abi = RrpBeaconServer.abi;
        const rrpBeaconServer = new ethers.Contract(
          (chain as any).contracts.RrpBeaconServer, // TODO: fix ChainConfig type
          abi,
          provider
        );

        triggers.rrpBeaconServerKeeperJobs.forEach(
          async ({
            templateId,
            oisTitle,
            endpointName,
            deviationPercentage,
            keeperSponsor,
            requestSponsor,
          }: any) => {
            // **************************************************************************
            // 3. Make API request
            // **************************************************************************
            const oisByTitle = ois.find((o) => o.title === oisTitle)!;
            const endpoint = oisByTitle.endpoints.find(
              (e) => e.name === endpointName
            )!;
            const adapterApiCredentials = apiCredentials.map(
              (c) => removeKey(c, "oisTitle") as adapter.ApiCredentials
            );

            const reservedParameters = getReservedParameters(endpoint, {});
            if (!reservedParameters._type) {
              console.log("[ERROR] missing type reserved parameter");
              return;
            }

            const template = await airnodeRrp.templates(templateId);
            if (!template) {
              console.log("[ERROR] template not found");
            }
            const templateParameters = safeDecode(template.parameters);
            const sanitizedParameters: adapter.Parameters = removeKeys(
              templateParameters || {},
              RESERVED_PARAMETERS
            );

            const options: adapter.BuildRequestOptions = {
              endpointName,
              parameters: { ...sanitizedParameters, from: "ETH" }, // TODO: fix hardcoded from param
              metadataParameters: {}, // TODO: fix hardcoded values
              ois: oisByTitle,
              apiCredentials: adapterApiCredentials,
            };

            const apiResponse = await adapter.buildAndExecuteRequest(options);
            if (!apiResponse || !apiResponse.data) {
              console.log("[ERROR] failed to fetch data from API");
              return;
            }
            console.log("[INFO] API server response data:", apiResponse.data);
            if (apiResponse.data === 0) {
              console.log("[ERROR] API responded with value of 0");
              return;
            }

            let apiValue: ethers.BigNumber;
            try {
              const response = adapter.extractAndEncodeResponse(
                apiResponse.data,
                reservedParameters as adapter.ReservedParameters
              );
              apiValue = ethers.BigNumber.from(
                adapter.bigNumberToString(response.value as any)
              );

              console.log("[INFO] API server value:", apiValue.toNumber());
            } catch (e) {
              console.log("[ERROR] failed to extract data from API response");
              return;
            }

            // **************************************************************************
            // 4. Read beacon
            // **************************************************************************
            // address(0) is considered whitelisted
            const voidSigner = new ethers.VoidSigner(
              ethers.constants.AddressZero,
              provider
            );
            const beaconResponse = await rrpBeaconServer
              .connect(voidSigner)
              .readBeacon(templateId);

            if (!beaconResponse) {
              console.log("[ERROR] failed to fetch data from beacon server");
              return;
            }
            console.log(
              "[INFO] beacon server value:",
              beaconResponse.value.toNumber()
            );

            // **************************************************************************
            // 5. Check deviation
            // **************************************************************************
            const delta = beaconResponse.value.sub(apiValue).abs();
            if (delta.eq(0)) {
              console.log("[INFO] beacon is up-to-date. skipping update");
              return;
            }

            const times = ethers.BigNumber.from(reservedParameters._times || 1);
            const basisPoints = ethers.utils.parseEther("1.0").div(100);
            const deviation = delta.mul(basisPoints).div(apiValue).div(times);
            console.log(
              "[INFO] deviation (%):",
              deviation.toNumber() / times.mul(100).toNumber()
            );

            // **************************************************************************
            // 6. Update beacon if necessary (call makeRequest)
            // **************************************************************************

            const tolerance = ethers.BigNumber.from(deviationPercentage).mul(
              times.mul(100)
            );
            if (deviation.lte(tolerance)) {
              console.log(
                "[INFO] delta between beacon and api value is within tolerance range. skipping update"
              );
              return;
            }

            /*
             * 1. Airnode must first call setSponsorshipStatus(rrpBeaconServer.address, true) to
             *    enable the beacon server to make requests to AirnodeRrp
             * 2. Request sponsor should then call setUpdatePermissionStatus(keeperSponsorWallet.address, true)
             *    to allow requester to update beacon
             */
            const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(
              nodeSettings.airnodeWalletMnemonic
            );
            const keeperSponsorWallet = deriveKeeperSponsorWallet(
              airnodeHDNode,
              keeperSponsor,
              provider
            );
            const requestSponsorWallet = deriveSponsorWallet(
              airnodeHDNode,
              requestSponsor
            );

            /*
             * Check to prevent sending the same request for beacon update more than once
             */
            // 1. fetch RequestedBeaconUpdate events by templateId, sponsor and sponsorWallet
            //TODO: do we want to put a limit to the number of blocks to query for?
            const requestedBeaconUpdateFilter =
              rrpBeaconServer.filters.RequestedBeaconUpdate(
                templateId,
                requestSponsor,
                keeperSponsorWallet.address
              );
            const requestedBeaconUpdateEvents =
              await rrpBeaconServer.queryFilter(requestedBeaconUpdateFilter);

            // 2. fetch UpdatedBeacon events by templateId
            const updatedBeaconFilter =
              rrpBeaconServer.filters.UpdatedBeacon(templateId);
            const updatedBeaconEvents = await rrpBeaconServer.queryFilter(
              updatedBeaconFilter
            );

            // 3. match these events by requestId
            //    unmatched events are the ones that are still waiting to be fulfilled
            const [pendingRequest] = requestedBeaconUpdateEvents.filter(
              (rbue) =>
                !updatedBeaconEvents.some(
                  (ub) => rbue.args!["requestId"] === ub.args!["requestId"]
                )
            );
            if (!isNil(pendingRequest)) {
              // `requestIdToTemplateId` is private so we must use AirnodeRrp instead
              // const y = await rrpBeaconServer.requestIdToTemplateId(
              //   pendingRequest.args!["requestId"]
              // );

              // 4. check if RequestedBeaconUpdate event is awaiting fulfillment by
              //    calling requestIsAwaitingFulfillment in AirnodeRrp with requestId
              //    and check if it's fresh enough and skip if it is
              const requestIsAwaitingFulfillment =
                await airnodeRrp.requestIsAwaitingFulfillment(
                  pendingRequest.args!["requestId"]
                );
              //TODO: timestamp check
              if (requestIsAwaitingFulfillment) {
                console.log(
                  "[INFO] request is awaiting fulfillment. skipping update"
                );
                return;
              }
            }

            // RrpBeaconServer expects that all parameters are defined in the template.
            // There's a Jira issue to try adding user-defined parameters to the RrpBeaconServer.
            // https://api3dao.atlassian.net/browse/A3P-48
            // When using config.json.example we must pass a `from` parameter and the only
            // way to get this request to work is if we add it as fixedParameter in the node
            // config file
            await rrpBeaconServer
              .connect(keeperSponsorWallet)
              .requestBeaconUpdate(
                templateId,
                requestSponsor,
                requestSponsorWallet.address
              );
          }
        );
      });
    });

  const response = { ok: true, data: { message: "Beacon update requested" } };
  return { statusCode: 200, body: JSON.stringify(response) };
};

export function loadAirkeeperConfig(): Config {
  const configPath = path.resolve(`${__dirname}/../config/airkeeper.json`);
  return JSON.parse(fs.readFileSync(configPath, "utf8"));
}

export function deriveKeeperSponsorWallet(
  airnodeHdNode: ethers.utils.HDNode,
  sponsorAddress: string,
  provider: ethers.providers.Provider
): ethers.Wallet {
  const sponsorWalletHdNode = airnodeHdNode.derivePath(
    `m/44'/60'/12345'/${deriveWalletPathFromSponsorAddress(sponsorAddress)}`
  );
  return new ethers.Wallet(sponsorWalletHdNode.privateKey).connect(provider);
}
