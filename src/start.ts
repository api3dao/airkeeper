import * as path from "path";
import * as ethers from "ethers";
import * as ois from "@api3/airnode-ois";
import * as node from "@api3/airnode-node";
import * as adapter from "@api3/airnode-adapter";
import * as protocol from "@api3/airnode-protocol";
import * as abi from "@api3/airnode-abi";
import flatMap from "lodash/flatMap";
import groupBy from "lodash/groupBy";
import isEmpty from "lodash/isEmpty";
import isNil from "lodash/isNil";
import map from "lodash/map";
import merge from "lodash/merge";
import { ChainConfig } from "./types";
import {
  loadAirkeeperConfig,
  deriveKeeperSponsorWallet,
  printError,
  retryGo,
} from "./utils";
// TODO: use node.evm.getGasPrice() once @api3/airnode-node is updated to v0.4.x
import { getGasPrice } from "./gas-prices";

export const GAS_LIMIT = 500_000;
export const BLOCK_COUNT_HISTORY_LIMIT = 300;

export const handler = async (_event: any = {}): Promise<any> => {
  const startedAt = new Date();
  console.log("[DEBUG]\tstarting Airkeeper...");
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
        // 2. Initialize provider specific data
        // **************************************************************************
        console.log("[DEBUG]\tinitializing...");
        const blockHistoryLimit =
          chain.blockHistoryLimit || BLOCK_COUNT_HISTORY_LIMIT;
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

        const airnodeHDNode = ethers.utils.HDNode.fromMnemonic(
          nodeSettings.airnodeWalletMnemonic
        );

        // Fetch current block number from chain via provider
        const [err, currentBlock] = await retryGo(() =>
          provider.getBlockNumber()
        );
        if (err || isNil(currentBlock)) {
          printError(err);
          console.log("[ERROR]\tfailed to fetch the blockNumber");
          return;
        }

        // **************************************************************************
        // 3. Run grouped by keeperSponsor address jobs in parallel
        //    but each keeper job in the group sequentially
        // **************************************************************************
        const rrpBeaconServerKeeperJobsByKeeperSponsor = groupBy(
          triggers.rrpBeaconServerKeeperJobs,
          "keeperSponsor"
        );
        const keeperSponsorAddresses = Object.keys(
          rrpBeaconServerKeeperJobsByKeeperSponsor
        );

        const keeperSponsorWalletPromises = keeperSponsorAddresses.map(
          async (keeperSponsor) => {
            const keeperSponsorWallet = deriveKeeperSponsorWallet(
              airnodeHDNode,
              keeperSponsor,
              provider
            );

            // Fetch keeperSponsorWallet transaction count
            const [err, keeperSponsorWalletTransactionCount] = await retryGo(
              () =>
                provider.getTransactionCount(
                  keeperSponsorWallet.address,
                  currentBlock
                )
            );
            if (err || isNil(keeperSponsorWalletTransactionCount)) {
              printError(err);
              console.log(
                "[ERROR]\tfailed to fetch the keeperSponsorWallet transaction count"
              );
              return;
            }
            let nonce = keeperSponsorWalletTransactionCount;

            const rrpBeaconServerKeeperJobs =
              rrpBeaconServerKeeperJobsByKeeperSponsor[keeperSponsor];

            for (const {
              templateId,
              parameters,
              oisTitle,
              endpointName,
              deviationPercentage,
              requestSponsor,
            } of rrpBeaconServerKeeperJobs) {
              // **************************************************************************
              // 4. Fetch template by ID
              // **************************************************************************
              console.log("[DEBUG]\tfetching template...");
              const [errTemplate, template] = await retryGo(() =>
                airnodeRrp.templates(templateId)
              );
              if (errTemplate || isNil(template)) {
                printError(errTemplate);
                console.log("[ERROR]\ttemplate not found:", templateId);
                continue;
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
                ...node.evm.encoding.safeDecode(template.parameters),
                ...configParameters,
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

              const [errBuildAndExecuteRequest, apiResponse] = await retryGo(
                () => adapter.buildAndExecuteRequest(options)
              );
              if (
                errBuildAndExecuteRequest ||
                isNil(apiResponse) ||
                isNil(apiResponse.data)
              ) {
                printError(errBuildAndExecuteRequest);
                console.log(
                  "[ERROR]\tfailed to fetch data from API for endpoint:",
                  endpointName
                );
                continue;
              }
              console.log(
                "[DEBUG]\tAPI server response data:",
                apiResponse.data
              );

              let apiValue: ethers.BigNumber;
              try {
                const response = adapter.extractAndEncodeResponse(
                  apiResponse.data,
                  reservedParameters as adapter.ReservedParameters
                );
                apiValue = ethers.BigNumber.from(response.values[0].toString());
              } catch (error) {
                printError(error);
                console.log(
                  "[ERROR]\tfailed to extract or encode value from API response:",
                  JSON.stringify(apiResponse.data)
                );
                continue;
              }
              console.log("[INFO]\tAPI server value:", apiValue.toString());

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
              const [errReadBeacon, beaconResponse] = await retryGo(() =>
                rrpBeaconServer.connect(voidSigner).readBeacon(beaconId)
              );
              if (
                errReadBeacon ||
                isNil(beaconResponse) ||
                isNil(beaconResponse.value)
              ) {
                printError(errReadBeacon);
                console.log(
                  "[ERROR]\tfailed to read value for beaconId:",
                  beaconId
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
              const [
                errRequestedBeaconUpdateFilter,
                requestedBeaconUpdateEvents,
              ] = await retryGo(() =>
                rrpBeaconServer.queryFilter(
                  requestedBeaconUpdateFilter,
                  blockHistoryLimit * -1,
                  currentBlock
                )
              );
              if (
                errRequestedBeaconUpdateFilter ||
                isNil(requestedBeaconUpdateEvents)
              ) {
                printError(errRequestedBeaconUpdateFilter);
                console.log(
                  "[ERROR]\tfailed to fetch RequestedBeaconUpdate events"
                );
                continue;
              }

              // 2. Fetch UpdatedBeacon events by beaconId
              const updatedBeaconFilter =
                rrpBeaconServer.filters.UpdatedBeacon(beaconId);
              const [errUpdatedBeaconFilter, updatedBeaconEvents] =
                await retryGo(() =>
                  rrpBeaconServer.queryFilter(
                    updatedBeaconFilter,
                    blockHistoryLimit * -1,
                    currentBlock
                  )
                );
              if (errUpdatedBeaconFilter || isNil(updatedBeaconEvents)) {
                printError(errUpdatedBeaconFilter);
                console.log("[ERROR]\tfailed to fetch UpdatedBeacon events");
                continue;
              }

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
                const [
                  errRequestIsAwaitingFulfillment,
                  requestIsAwaitingFulfillment,
                ] = await retryGo(() =>
                  airnodeRrp.requestIsAwaitingFulfillment(
                    pendingRequestedBeaconUpdateEvent.args!["requestId"]
                  )
                );
                if (errRequestIsAwaitingFulfillment) {
                  printError(errRequestIsAwaitingFulfillment);
                  console.log(
                    "[INFO]\tfailed to check if request is awaiting fulfillment"
                  );
                  continue;
                }
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

              // Submit requestBeaconUpdate transaction
              const currentNonce = nonce;
              const [errRequestBeaconUpdate] = await retryGo(() =>
                rrpBeaconServer
                  .connect(keeperSponsorWallet)
                  .requestBeaconUpdate(
                    templateId,
                    requestSponsor,
                    requestSponsorWallet.address,
                    encodedParameters,
                    {
                      gasLimit: GAS_LIMIT,
                      ...gasTarget,
                      nonce: nonce++,
                    }
                  )
              );
              if (errRequestBeaconUpdate) {
                printError(errRequestBeaconUpdate);
                console.log(
                  `[ERROR]\tfailed to submit transaction using wallet ${keeperSponsorWallet.address} with nonce ${currentNonce}. skipping update`
                );
              }
            }
          }
        );

        await Promise.all(keeperSponsorWalletPromises);
      });
    })
  );

  await Promise.all(providerPromises);

  const completedAt = new Date();
  const durationMs = Math.abs(completedAt.getTime() - startedAt.getTime());
  console.log(`[DEBUG]\tfinishing Airkeeper after ${durationMs}ms...`);

  const response = {
    ok: true,
    data: { message: "Airkeeper invocation finished" },
  };
  return { statusCode: 200, body: JSON.stringify(response) };
};
