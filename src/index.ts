import * as fs from "fs";
import * as path from "path";
import * as ethers from "ethers";
import * as node from "@api3/airnode-node";
import * as adapter from "@api3/airnode-adapter";
import * as protocol from "@api3/airnode-protocol";
import { flatMap, isEmpty, isNil, map, merge } from "lodash";
import { ChainConfig, Config } from "./types";

export const handler = async (event: any = {}): Promise<any> => {
  const startedAt = new Date();
  console.log("[DEBUG]\tstarting beaconUpdate...");
  // **************************************************************************
  // 1. Load config (this file must be the same as the one used by the node)
  // **************************************************************************
  const nodeConfigPath = path.resolve(`${__dirname}/../config/airnode.json`);
  const nodeConfig = node.config.parseConfig(nodeConfigPath, process.env);
  const keeperConfig = loadAirkeeperConfig();
  const config = merge(nodeConfig, keeperConfig);

  const { chains, nodeSettings, triggers, ois, apiCredentials } = config;
  const evmChains = chains.filter(
    (chain: node.ChainConfig & ChainConfig) => chain.type === "evm"
  );
  if (isEmpty(chains)) {
    throw new Error(
      "One or more evm compatible chain(s) must be defined in the provided config"
    );
  }

  const providerPromises = flatMap(
    evmChains.map((chain: node.ChainConfig & ChainConfig) => {
      return map(chain.providers, async (chainProvider, _) => {
        // **************************************************************************
        // 2. Initialize provider and contracts
        // **************************************************************************
        console.log("[DEBUG]\tinitializing...");
        const chainProviderUrl = chainProvider.url || "";
        const provider = node.evm.buildEVMProvider(chainProviderUrl, chain.id);

        const airnodeRrp = protocol.AirnodeRrpFactory.connect(
          chain.contracts.AirnodeRrp,
          provider
        );

        // TODO: use factory class to create contract instead
        const rrpBeaconServer = protocol.RrpBeaconServerFactory.connect(
          chain.contracts.RrpBeaconServer,
          provider
        );
        // const abi = RrpBeaconServer.abi;
        // const rrpBeaconServer = new ethers.Contract(
        //   chain.contracts.RrpBeaconServer,
        //   abi,
        //   provider
        // );

        // **************************************************************************
        // 3. Run each keeper job
        // **************************************************************************
        for (const {
          templateId,
          oisTitle,
          endpointName,
          deviationPercentage,
          keeperSponsor,
          requestSponsor,
        } of triggers.rrpBeaconServerKeeperJobs) {
          // **************************************************************************
          // 4. Fetch template by ID
          // **************************************************************************
          console.log("[DEBUG]\tfetching template...");
          const template = await airnodeRrp.templates(templateId);
          if (!template) {
            console.log("[ERROR]\ttemplate not found");
          }

          // **************************************************************************
          // 5. Make API request
          // **************************************************************************
          console.log("[DEBUG]\tmaking API request...");
          const configOis = ois.find((o) => o.title === oisTitle)!;
          const configEndpoint = configOis.endpoints.find(
            (e) => e.name === endpointName
          )!;
          const templateParameters = node.evm.encoding.safeDecode(
            template.parameters
          );
          const reservedParameters =
            node.adapters.http.parameters.getReservedParameters(
              configEndpoint,
              templateParameters || {}
            );
          if (!reservedParameters._type) {
            console.log("[ERROR]\treserved parameter 'type' is missing");
            return;
          }
          const sanitizedParameters: adapter.Parameters = node.utils.removeKeys(
            templateParameters || {},
            node.adapters.http.parameters.RESERVED_PARAMETERS
          );
          const adapterApiCredentials = apiCredentials
            .filter((c) => c.oisTitle === oisTitle)
            .map(
              (c) =>
                node.utils.removeKey(c, "oisTitle") as adapter.ApiCredentials
            );

          const options: adapter.BuildRequestOptions = {
            ois: configOis,
            endpointName,
            parameters: sanitizedParameters,
            apiCredentials: adapterApiCredentials,
            metadata: null, // TODO: https://github.com/api3dao/airnode/pull/697
          };

          const apiResponse = await adapter.buildAndExecuteRequest(options);
          if (!apiResponse || !apiResponse.data) {
            console.log("[ERROR]\tfailed to fetch data from API");
            return;
          }
          console.log("[INFO]\tAPI server response data:", apiResponse.data);
          // TODO: should we really return here or 0 could be a valid response?
          if (apiResponse.data === 0) {
            console.log("[ERROR]\tAPI responded with value of 0");
            return;
          }

          let apiValue: ethers.BigNumber;
          try {
            const response = adapter.extractAndEncodeResponse(
              apiResponse.data,
              reservedParameters as adapter.ReservedParameters
            );
            apiValue = ethers.BigNumber.from(
              adapter.bigNumberToString(response.values[0] as any) // TODO: node change value to values
            );

            console.log("[INFO]\tAPI server value:", apiValue.toString());
          } catch (e) {
            console.log("[ERROR]\tfailed to extract data from API response");
            return;
          }

          // **************************************************************************
          // 6. Read beacon
          // **************************************************************************
          console.log("[DEBUG]\treading beacon value from server...");
          // address(0) is considered whitelisted
          const voidSigner = new ethers.VoidSigner(
            ethers.constants.AddressZero,
            provider
          );
          const beaconResponse = await rrpBeaconServer
            .connect(voidSigner)
            .readBeacon(templateId);

          if (!beaconResponse) {
            console.log("[ERROR]\tfailed to fetch data from beacon server");
            return;
          }
          console.log(
            "[INFO]\tbeacon server value:",
            beaconResponse.value.toString()
          );

          // **************************************************************************
          // 7. Check deviation
          // **************************************************************************
          console.log("[DEBUG]\tchecking deviation...");
          const delta = beaconResponse.value.sub(apiValue).abs();
          if (delta.eq(0)) {
            console.log("[INFO]\tbeacon is up-to-date. skipping update");
            return;
          }

          const times = ethers.BigNumber.from(reservedParameters._times || 1);
          const basisPoints = ethers.utils.parseEther("1.0").div(100);
          const deviation = delta.mul(basisPoints).div(apiValue).div(times);
          console.log(
            "[INFO]\tdeviation (%):",
            deviation.toNumber() / times.mul(100).toNumber()
          );

          // **************************************************************************
          // 8. Update beacon if necessary (call makeRequest)
          // **************************************************************************
          const tolerance = ethers.BigNumber.from(deviationPercentage).mul(
            times.mul(100)
          );
          if (deviation.lte(tolerance)) {
            console.log(
              "[INFO]\tdelta between beacon and api value is within tolerance range. skipping update"
            );
            return;
          }
          console.log("[DEBUG]\tupdating beacon...");

          /**
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
          const requestSponsorWallet = node.evm.deriveSponsorWallet(
            airnodeHDNode,
            requestSponsor
          );

          /**
           * Check to prevent sending the same request for beacon update more than once
           */

          // 1. Fetch RequestedBeaconUpdate events by templateId, sponsor and sponsorWallet
          //TODO: do we want to put a limit to the number of blocks to query for?
          const requestedBeaconUpdateFilter =
            rrpBeaconServer.filters.RequestedBeaconUpdate(
              templateId,
              requestSponsor,
              keeperSponsorWallet.address
            );
          const requestedBeaconUpdateEvents = await rrpBeaconServer.queryFilter(
            requestedBeaconUpdateFilter
          );

          // 2. Fetch UpdatedBeacon events by templateId
          const updatedBeaconFilter =
            rrpBeaconServer.filters.UpdatedBeacon(templateId);
          const updatedBeaconEvents = await rrpBeaconServer.queryFilter(
            updatedBeaconFilter
          );

          // 3. Match these events by requestId and unmatched events
          //    are the ones that are still waiting to be fulfilled
          const [pendingRequestedBeaconUpdateEvent] =
            requestedBeaconUpdateEvents.filter(
              (rbue) =>
                !updatedBeaconEvents.some(
                  (ub) => rbue.args!["requestId"] === ub.args!["requestId"]
                )
            );
          if (!isNil(pendingRequestedBeaconUpdateEvent)) {
            // 4. Check if RequestedBeaconUpdate event is awaiting fulfillment by
            //    calling AirnodeRrp.requestIsAwaitingFulfillment with requestId
            //    and check if beacon value is fresh enough and skip if it is

            // `requestIdToTemplateId` is private so we must use AirnodeRrp instead
            // const requestIsAwaitingFulfillment = await rrpBeaconServer.requestIdToTemplateId(
            //   pendingRequest.args!["requestId"]
            // );

            const requestIsAwaitingFulfillment =
              await airnodeRrp.requestIsAwaitingFulfillment(
                pendingRequestedBeaconUpdateEvent.args!["requestId"]
              );
            //TODO: Add timestamp check?
            if (requestIsAwaitingFulfillment) {
              console.log(
                "[INFO]\trequest is awaiting fulfillment. skipping update"
              );
              return;
            }
          }

          // RrpBeaconServer expects that all parameters are defined in the template.
          // There's a Jira issue to try adding user-defined parameters to the RrpBeaconServer.
          // https://api3dao.atlassian.net/browse/A3P-48
          // When using config.json.example we must pass a `from` parameter and the only
          // way to get this request to work is by adding it as fixedParameter in the node config file
          await rrpBeaconServer
            .connect(keeperSponsorWallet)
            .requestBeaconUpdate(
              templateId,
              requestSponsor,
              requestSponsorWallet.address
            );
        }
      });
    })
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  console.log(`[DEBUG]\tfinishing beaconUpdate after ${durationMs}ms...`);

  const response = {
    ok: true,
    data: { message: "Beacon update invocation finished" },
  };
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
    `m/44'/60'/12345'/${node.evm.deriveWalletPathFromSponsorAddress(
      sponsorAddress
    )}`
  );
  return new ethers.Wallet(sponsorWalletHdNode.privateKey).connect(provider);
}
