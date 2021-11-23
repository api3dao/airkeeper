import * as adapter from "@api3/airnode-adapter";
import * as node from "@api3/airnode-node";
import { AirnodeRrpFactory } from "@api3/airnode-protocol";
import * as dotenv from "dotenv";
import * as ethers from "ethers";
import * as fs from "fs";
import { each, isEmpty } from "lodash";
import * as path from "path";
import { safeDecode } from "./node/abi-encoding";
//TODO: remove and use @api3/airnode-node import
import { buildEVMProvider } from "./node/evm-provider";
//TODO: remove and use @api3/airnode-node import
import { removeKey, removeKeys } from "./node/object-utils";
//TODO: remove and use @api3/airnode-node import
import { getReservedParameters, RESERVED_PARAMETERS } from "./node/parameters";
//TODO: remove and use @api3/airnode-node import
import { deriveSponsorWallet } from "./node/wallet";
//TODO: remove and use "@api3/airnode-protocol" import;
import RrpBeaconServer from "./RrpBeaconServer.json";

export const handler = async (event: any = {}): Promise<any> => {
  // **************************************************************************
  // 1. Load config (this file must be the same as the one used by the node)
  // **************************************************************************
  const secretsPath = path.resolve(`${__dirname}/../config/secrets.env`);
  const secrets = dotenv.parse(fs.readFileSync(secretsPath));

  const configPath = path.resolve(`${__dirname}/../config/config.json`);
  const config = node.config.parseConfig(configPath, secrets);

  const { chains, nodeSettings, triggers, ois, apiCredentials } = config;
  if (isEmpty(chains)) {
    throw new Error(
      "One or more chains must be defined in the provided config"
    );
  }
  chains
    .filter((chain: node.ChainConfig) => chain.type === "evm")
    .forEach(async (chain: node.ChainConfig) => {
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
        //   const rrpBeaconServer = RrpBeaconServerFactory.connect(RrpBeaconServer.address, provider);
        const abi = RrpBeaconServer.abi;
        const rrpBeaconServer = new ethers.Contract(
          chain.contracts.RrpBeaconServer,
          abi,
          provider
        );

        const airnodeWallet = ethers.Wallet.fromMnemonic(
          nodeSettings.airnodeWalletMnemonic
        ).connect(provider);

        // TODO: should templateId come from triggers or somewhere else?
        triggers.rrp.forEach(
          async ({ templateId, endpointId, oisTitle, endpointName }: any) => {
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
              console.log("Error: missing type reserved parameter");
              return;
            }

            const template = await airnodeRrp.templates(templateId);
            if (!template) {
              console.log("Error: template not found");
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
              console.log("Error: failed to fetch data from API");
              return;
            }
            console.log("Info: API server value", apiResponse.data);
            if (apiResponse.data === 0) {
              console.log("Error: API responded with value of 0");
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
            } catch (e) {
              console.log("Error: failed to extract data from API response");
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
            // const beaconResponse = { value: ethers.BigNumber.from("683392028") };

            if (!beaconResponse) {
              console.log("Error: failed to fetch data from beacon server");
              return;
            }
            console.log("Info: beacon server value", beaconResponse.value);

            // **************************************************************************
            // 5. Check deviation
            // **************************************************************************
            const delta = beaconResponse.value.sub(apiValue).abs();
            if (delta.eq(0)) {
              console.log("Info: beacon is up-to-date. skipping update");
              return;
            }

            const deviation = delta
              .mul(100 * Number(reservedParameters._times)) // TODO: can _times be null or 0?
              .div(apiValue);
            console.log(
              "Info: deviation %",
              deviation.toNumber() / Number(reservedParameters._times)
            );

            // **************************************************************************
            // 6. Update beacon if necessary (call makeRequest)
            // **************************************************************************

            // TODO: should we calculate the requestId hash or find a way to prevent sending
            // the same request more that once? RrpBeaconServer.requestIdToTemplateId keeps
            // track of the pending requests using a templateId

            // TODO: 5% is hardcoded, should this be read from config?
            const tolerance = 5;
            if (deviation.lte(tolerance * Number(reservedParameters._times))) {
              console.log(
                "Info: delta between beacon and api value is within tolerance range. skipping update"
              );
              return;
            }

            /*
             * 1. Airnode must first call setSponsorshipStatus(rrpBeaconServer.address, true) to
             *    enable the beacon server to make requests to AirnodeRrp
             * 2. Sponsor should then call setUpdatePermissionStatus(airnodeWallet.address, true)
             *    to allow requester to update beacon
             */
            // console.log(
            //   "🚀 ~ file: index.ts ~ line 161 ~ handler ~ await rrpBeaconServer.sponsorToUpdateRequesterToPermissionStatus()",
            //   await rrpBeaconServer.sponsorToUpdateRequesterToPermissionStatus(
            //     airnodeWallet.address,
            //     airnodeWallet.address
            //   )
            // );

            // TODO: who should be the sponsor?
            // it's kinda weird to have to derive the sponsor wallet for the airnode wallet
            const sponsorWalletAddress = deriveSponsorWallet(
              ethers.utils.HDNode.fromMnemonic(
                nodeSettings.airnodeWalletMnemonic
              ),
              airnodeWallet.address
            ).address;

            // TODO: why can't we send encoded parameters to be forwarded to AirnodeRrp?
            // When using config.json.example we must pass a "from" parameter and the only
            // way to get this request to work is if we add it a fixedParameter in the node
            // config file
            await rrpBeaconServer
              .connect(airnodeWallet)
              .requestBeaconUpdate(
                templateId,
                airnodeWallet.address,
                sponsorWalletAddress
              );
          }
        );
      });
    });

  const response = { ok: true, data: { message: "Beacon update completed" } };
  return { statusCode: 200, body: JSON.stringify(response) };
};
