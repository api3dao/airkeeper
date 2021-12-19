import * as path from "path";
import * as ethers from "ethers";
import * as ois from "@api3/airnode-ois";
import * as node from "@api3/airnode-node";
import * as adapter from "@api3/airnode-adapter";
import * as protocol from "@api3/airnode-protocol";
import * as abi from "@api3/airnode-abi";
import { flatMap, groupBy, isEmpty, isNil, map, merge } from "lodash";
import { ChainConfig } from "./types";
import { loadAirkeeperConfig, deriveKeeperSponsorWallet } from "./utils";
// TODO: use node.evm.getGasPrice() once @api3/airnode-node is updated
import { getGasPrice } from "./gas-prices";

const GAS_LIMIT = 500_000;

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();
  console.log("[DEBUG]\tstarting beaconUpdate...");
  // **************************************************************************
  // 1. Load config (this file must be the same as the one used by the node)
  // **************************************************************************
  const nodeConfigPath = path.resolve(`${__dirname}/../config/config.json`);
  const nodeConfig = node.config.parseConfig(nodeConfigPath, process.env);
  const keeperConfig = loadAirkeeperConfig();
  const config = merge(nodeConfig, keeperConfig);

  const { chains, nodeSettings, triggers, ois: oises, apiCredentials } = config;
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

        const rrpBeaconServer = protocol.RrpBeaconServerFactory.connect(
          chain.contracts.RrpBeaconServer,
          provider
        );

        // **************************************************************************
        // 3. Run each keeper job by keeperSponsor address sequentially
        // **************************************************************************
        const rrpBeaconServerKeeperJobsByKeeperSponsor = groupBy(
          triggers.rrpBeaconServerKeeperJobs,
          "keeperSponsor"
        );
        const keeperSponsorAddresses = Object.keys(
          rrpBeaconServerKeeperJobsByKeeperSponsor
        );

        const promises = keeperSponsorAddresses.map(
          async (keeperSponsorAddress) => {
            const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(
              nodeSettings.airnodeWalletMnemonic
            );
            const keeperSponsorWallet = deriveKeeperSponsorWallet(
              airnodeHDNode,
              keeperSponsorAddress,
              provider
            );

            const currentBlock = await provider.getBlockNumber();

            // Fetch keeperSponsorWallet transaction count
            let keeperSponsorWalletTransactionCount =
              await provider.getTransactionCount(
                keeperSponsorWallet.address,
                currentBlock
              );
            console.log(
              "🚀 ~ file: start.ts ~ line 83 ~ keeperSponsorWalletTransactionCount",
              keeperSponsorWalletTransactionCount
            );

            const rrpBeaconServerKeeperJobs =
              rrpBeaconServerKeeperJobsByKeeperSponsor[keeperSponsorAddress];

            for (const {
              templateId,
              parameters,
              oisTitle,
              endpointName,
              deviationPercentage,
              requestSponsor,
              eventLogMaxBlocks,
            } of rrpBeaconServerKeeperJobs) {
              // **************************************************************************
              // 4. Fetch template by ID
              // **************************************************************************
              console.log("[DEBUG]\tfetching template...");
              const template = await airnodeRrp.templates(templateId);
              if (!template) {
                console.log("[ERROR]\ttemplate not found:", templateId);
              }

              // **************************************************************************
              // 5. Make API request
              // **************************************************************************
              console.log("[DEBUG]\tmaking API request...");
              const configOis = oises.find((o) => o.title === oisTitle)!;
              const configEndpoint = configOis.endpoints.find(
                (e) => e.name === endpointName
              )!;
              const configParameters = parameters.reduce(
                (acc, p) => ({ ...acc, [p.name]: p.value }),
                {}
              );
              const apiCallParameters = {
                ...configParameters,
                ...node.evm.encoding.safeDecode(template.parameters),
              };
              const reservedParameters =
                node.adapters.http.parameters.getReservedParameters(
                  configEndpoint,
                  apiCallParameters || {}
                );
              if (!reservedParameters._type) {
                console.log(
                  "[ERROR]\treserved parameter 'type' is missing for endpoint:",
                  endpointName
                );
                continue;
              }
              const sanitizedParameters: adapter.Parameters =
                node.utils.removeKeys(
                  apiCallParameters || {},
                  ois.RESERVED_PARAMETERS
                );
              const adapterApiCredentials = apiCredentials
                .filter((c) => c.oisTitle === oisTitle)
                .map((c) => node.utils.removeKey(c, "oisTitle"));

              const options: adapter.BuildRequestOptions = {
                ois: configOis,
                endpointName,
                parameters: sanitizedParameters,
                apiCredentials:
                  adapterApiCredentials as adapter.ApiCredentials[],
                metadata: null,
              };

              const apiResponse = await adapter.buildAndExecuteRequest(options);
              if (!apiResponse || !apiResponse.data) {
                console.log(
                  "[ERROR]\tfailed to fetch data from API for endpoint:",
                  endpointName
                );
                continue;
              }
              console.log(
                "[INFO]\tAPI server response data:",
                apiResponse.data
              );

              let apiValue: ethers.BigNumber;
              try {
                const response = adapter.extractAndEncodeResponse(
                  apiResponse.data,
                  reservedParameters as adapter.ReservedParameters
                );
                apiValue = ethers.BigNumber.from(response.values[0].toString());

                console.log("[INFO]\tAPI server value:", apiValue.toString());
              } catch (error) {
                console.log(
                  "[ERROR]\tfailed to extract value from API response:",
                  JSON.stringify(apiResponse.data)
                );
                let message;
                if (error instanceof Error) message = error.message;
                else message = String(error);
                console.log("[DEBUG]\tmessage:", message);
                continue;
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
              const encodedParameters = abi.encode(parameters);
              const beaconId = ethers.utils.solidityKeccak256(
                ["bytes32", "bytes"],
                [templateId, encodedParameters]
              );
              const beaconResponse = await rrpBeaconServer
                .connect(voidSigner)
                .readBeacon(beaconId);

              if (!beaconResponse) {
                console.log(
                  "[ERROR]\tfailed to fetch value from beacon server for template:",
                  templateId
                );
                continue;
              }
              console.log(
                "[INFO]\tbeacon server value:",
                beaconResponse.value.toString()
              );

              // **************************************************************************
              // 7. Check deviation
              // **************************************************************************
              console.log("[DEBUG]\tchecking deviation...");
              let beaconValue = beaconResponse.value;
              const delta = beaconValue.sub(apiValue).abs();
              if (delta.eq(0)) {
                console.log("[INFO]\tbeacon is up-to-date. skipping update");
                continue;
              }

              beaconValue = beaconResponse.value.isZero()
                ? ethers.constants.One
                : beaconResponse.value;
              const basisPoints = ethers.utils.parseUnits("1", 16);
              const deviation = delta
                .mul(basisPoints)
                .mul(100)
                .div(beaconValue);
              console.log(
                "[INFO]\tdeviation (%):",
                ethers.utils.formatUnits(deviation, 16)
              );

              // **************************************************************************
              // 8. Update beacon if necessary (call makeRequest)
              // **************************************************************************
              const percentageThreshold =
                ethers.BigNumber.from(deviationPercentage).mul(basisPoints);
              if (deviation.lte(percentageThreshold)) {
                console.log(
                  "[INFO]\tdelta between beacon value and api value is within threshold. skipping update"
                );
                continue;
              }
              console.log("[DEBUG]\tupdating beacon...");
              /**
               * 1. Airnode must first call setSponsorshipStatus(rrpBeaconServer.address, true) to
               *    enable the beacon server to make requests to AirnodeRrp
               * 2. Request sponsor should then call setUpdatePermissionStatus(keeperSponsorWallet.address, true)
               *    to allow requester to update beacon
               */

              const requestSponsorWallet = node.evm.deriveSponsorWallet(
                airnodeHDNode,
                requestSponsor
              );

              // Check to prevent sending the same request for beacon update more than once
              // by checking if a RequestedBeaconUpdate event was emitted but no matching
              // UpdatedBeacon event was emitted.

              // 1. Fetch RequestedBeaconUpdate events by beaconId, sponsor and sponsorWallet
              const requestedBeaconUpdateFilter =
                rrpBeaconServer.filters.RequestedBeaconUpdate(
                  beaconId,
                  requestSponsor,
                  keeperSponsorWallet.address
                );
              const requestedBeaconUpdateEvents =
                await rrpBeaconServer.queryFilter(
                  requestedBeaconUpdateFilter,
                  eventLogMaxBlocks * -1,
                  currentBlock
                );
              console.log(
                "🚀 ~ file: start.ts ~ line 252 ~ returnmap ~ requestedBeaconUpdateEvents",
                requestedBeaconUpdateEvents.length
              );

              // 2. Fetch UpdatedBeacon events by beaconId
              const updatedBeaconFilter =
                rrpBeaconServer.filters.UpdatedBeacon(beaconId);
              const updatedBeaconEvents = await rrpBeaconServer.queryFilter(
                updatedBeaconFilter,
                eventLogMaxBlocks * -1,
                currentBlock
              );
              console.log(
                "🚀 ~ file: start.ts ~ line 264 ~ returnmap ~ updatedBeaconEvents",
                updatedBeaconEvents.length
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

                const requestIsAwaitingFulfillment =
                  await airnodeRrp.requestIsAwaitingFulfillment(
                    pendingRequestedBeaconUpdateEvent.args!["requestId"]
                  );
                if (requestIsAwaitingFulfillment) {
                  console.log(
                    "[INFO]\trequest is awaiting fulfillment. skipping update"
                  );
                  continue;
                }
              }

              // Fetch current gas fee data
              const [gasPriceLogs, gasTarget] = await getGasPrice({
                provider,
                chainOptions: chain.options,
              });
              if (!isEmpty(gasPriceLogs)) {
                gasPriceLogs.forEach((log) =>
                  console.log(`[${log.level}]\t${log.message}`)
                );
              }
              if (!gasTarget) {
                console.log(
                  "[ERROR]\tunable to submit transactions without gas price. skipping update"
                );
                continue;
              }

              const nonce = keeperSponsorWalletTransactionCount++;
              try {
                await rrpBeaconServer
                  .connect(keeperSponsorWallet)
                  .requestBeaconUpdate(
                    templateId,
                    requestSponsor,
                    requestSponsorWallet.address,
                    encodedParameters,
                    {
                      gasLimit: GAS_LIMIT,
                      ...gasTarget,
                      nonce,
                    }
                  );
              } catch {
                console.log(
                  `[ERROR]\tfailed to submit transaction using wallet ${keeperSponsorWallet.address} with nonce ${nonce}. skipping update`
                );
              }
              console.log(
                "PENDING AFTER:",
                await provider.send("eth_getBlockByNumber", ["pending", true])
              );
            }
          }
        );

        await Promise.all(promises);
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
