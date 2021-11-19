"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    Object.defineProperty(o, k2, { enumerable: true, get: function() { return m[k]; } });
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || function (mod) {
    if (mod && mod.__esModule) return mod;
    var result = {};
    if (mod != null) for (var k in mod) if (k !== "default" && Object.prototype.hasOwnProperty.call(mod, k)) __createBinding(result, mod, k);
    __setModuleDefault(result, mod);
    return result;
};
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __generator = (this && this.__generator) || function (thisArg, body) {
    var _ = { label: 0, sent: function() { if (t[0] & 1) throw t[1]; return t[1]; }, trys: [], ops: [] }, f, y, t, g;
    return g = { next: verb(0), "throw": verb(1), "return": verb(2) }, typeof Symbol === "function" && (g[Symbol.iterator] = function() { return this; }), g;
    function verb(n) { return function (v) { return step([n, v]); }; }
    function step(op) {
        if (f) throw new TypeError("Generator is already executing.");
        while (_) try {
            if (f = 1, y && (t = op[0] & 2 ? y["return"] : op[0] ? y["throw"] || ((t = y["return"]) && t.call(y), 0) : y.next) && !(t = t.call(y, op[1])).done) return t;
            if (y = 0, t) op = [op[0] & 2, t.value];
            switch (op[0]) {
                case 0: case 1: t = op; break;
                case 4: _.label++; return { value: op[1], done: false };
                case 5: _.label++; y = op[1]; op = [0]; continue;
                case 7: op = _.ops.pop(); _.trys.pop(); continue;
                default:
                    if (!(t = _.trys, t = t.length > 0 && t[t.length - 1]) && (op[0] === 6 || op[0] === 2)) { _ = 0; continue; }
                    if (op[0] === 3 && (!t || (op[1] > t[0] && op[1] < t[3]))) { _.label = op[1]; break; }
                    if (op[0] === 6 && _.label < t[1]) { _.label = t[1]; t = op; break; }
                    if (t && _.label < t[2]) { _.label = t[2]; _.ops.push(op); break; }
                    if (t[2]) _.ops.pop();
                    _.trys.pop(); continue;
            }
            op = body.call(thisArg, _);
        } catch (e) { op = [6, e]; y = 0; } finally { f = t = 0; }
        if (op[0] & 5) throw op[1]; return { value: op[0] ? op[1] : void 0, done: true };
    }
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handler = void 0;
var adapter = __importStar(require("@api3/airnode-adapter"));
var dotenv = __importStar(require("dotenv"));
var ethers = __importStar(require("ethers"));
var fs = __importStar(require("fs"));
var path = __importStar(require("path"));
var node = __importStar(require("@api3/airnode-node"));
var lodash_1 = require("lodash");
//TODO: remove and use @api3/airnode-node import
var evm_provider_1 = require("./node/evm-provider");
//TODO: remove and use @api3/airnode-node import
var parameters_1 = require("./node/parameters");
//TODO: remove and use @api3/airnode-node import
var object_utils_1 = require("./node/object-utils");
//TODO: remove and use @api3/airnode-node import
var wallet_1 = require("./node/wallet");
//TODO: remove and use "@api3/airnode-protocol" import;
var RrpBeaconServer_json_1 = __importDefault(require("./RrpBeaconServer.json"));
var handler = function (event) {
    if (event === void 0) { event = {}; }
    return __awaiter(void 0, void 0, void 0, function () {
        var secretsPath, secrets, configPath, config, chains, response;
        return __generator(this, function (_a) {
            secretsPath = path.resolve(__dirname + "/config/secrets.env");
            secrets = dotenv.parse(fs.readFileSync(secretsPath));
            configPath = path.resolve(__dirname + "/config/config.json");
            config = node.config.parseConfig(configPath, secrets);
            chains = config.chains;
            if ((0, lodash_1.isEmpty)(chains)) {
                throw new Error("One or more chains must be defined in the provided config");
            }
            chains
                .filter(function (chain) { return chain.type === "evm"; })
                .forEach(function (chain) { return __awaiter(void 0, void 0, void 0, function () {
                return __generator(this, function (_a) {
                    (0, lodash_1.each)(chain.providers, function (_, providerName) { return __awaiter(void 0, void 0, void 0, function () {
                        var chainProviderUrl, provider, abi, rrpBeaconServer, airnodeWallet;
                        return __generator(this, function (_a) {
                            chainProviderUrl = chain.providers[providerName].url || "";
                            provider = (0, evm_provider_1.buildEVMProvider)(chainProviderUrl, chain.id);
                            abi = RrpBeaconServer_json_1.default.abi;
                            rrpBeaconServer = new ethers.Contract(chain.contracts.RrpBeaconServer, abi, provider);
                            airnodeWallet = ethers.Wallet.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic).connect(provider);
                            config.triggers.rrp.forEach(function (_a) {
                                var templateId = _a.templateId, endpointId = _a.endpointId, oisTitle = _a.oisTitle, endpointName = _a.endpointName;
                                return __awaiter(void 0, void 0, void 0, function () {
                                    var ois, endpoint, reservedParameters, apiCredentials, options, apiResponse, apiValue, extracted, beaconResponse, delta, deviation, tolerance, sponsorWalletAddress;
                                    return __generator(this, function (_b) {
                                        switch (_b.label) {
                                            case 0:
                                                ois = config.ois.find(function (o) { return o.title === oisTitle; });
                                                endpoint = ois.endpoints.find(function (e) { return e.name === endpointName; });
                                                reservedParameters = (0, parameters_1.getReservedParameters)(endpoint, {});
                                                if (!reservedParameters._type) {
                                                    console.log("Error: missing type reserved parameter");
                                                    return [2 /*return*/];
                                                }
                                                apiCredentials = config.apiCredentials.map(function (c) { return (0, object_utils_1.removeKey)(c, "oisTitle"); });
                                                options = {
                                                    endpointName: endpointName,
                                                    parameters: { to: "USD", from: "ETH" },
                                                    metadataParameters: {},
                                                    ois: ois,
                                                    apiCredentials: apiCredentials,
                                                };
                                                return [4 /*yield*/, adapter.buildAndExecuteRequest(options)];
                                            case 1:
                                                apiResponse = _b.sent();
                                                if (!apiResponse || !apiResponse.data) {
                                                    console.log("Error: failed to fetch data from API");
                                                    return [2 /*return*/];
                                                }
                                                console.log("Info: API server value", apiResponse.data);
                                                if (apiResponse.data === 0) {
                                                    console.log("Error: API responded with value of 0");
                                                    return [2 /*return*/];
                                                }
                                                try {
                                                    extracted = adapter.extractAndEncodeResponse(apiResponse.data, reservedParameters);
                                                    apiValue = ethers.BigNumber.from(adapter.bigNumberToString(extracted.value));
                                                }
                                                catch (e) {
                                                    console.log("Error: failed to extract data from API response");
                                                    return [2 /*return*/];
                                                }
                                                // **************************************************************************
                                                // 4. Read beacon
                                                // **************************************************************************
                                                // HACK: whitelisting the requester for now just for testing against local eth node
                                                //       RrpBeaconServer.readerCanReadBeacon() will be updated to also check if the
                                                //       reader is the airnode in the template
                                                //       another option could be to just read UpdatedBeacon events
                                                // TODO-TEST: REMOVE THIS HACK AFTER FIRST RUN
                                                return [4 /*yield*/, rrpBeaconServer
                                                        .connect(airnodeWallet)
                                                        .setIndefiniteWhitelistStatus(templateId, airnodeWallet.address, true)];
                                            case 2:
                                                // **************************************************************************
                                                // 4. Read beacon
                                                // **************************************************************************
                                                // HACK: whitelisting the requester for now just for testing against local eth node
                                                //       RrpBeaconServer.readerCanReadBeacon() will be updated to also check if the
                                                //       reader is the airnode in the template
                                                //       another option could be to just read UpdatedBeacon events
                                                // TODO-TEST: REMOVE THIS HACK AFTER FIRST RUN
                                                _b.sent();
                                                return [4 /*yield*/, rrpBeaconServer
                                                        .connect(airnodeWallet)
                                                        .readBeacon(templateId)];
                                            case 3:
                                                beaconResponse = _b.sent();
                                                // const beaconResponse = { value: ethers.BigNumber.from("683392028") };
                                                if (!beaconResponse) {
                                                    console.log("Error: failed to fetch data from beacon server");
                                                    return [2 /*return*/];
                                                }
                                                console.log("Info: beacon server value", beaconResponse.value);
                                                delta = beaconResponse.value.sub(apiValue).abs();
                                                if (delta.eq(0)) {
                                                    console.log("Info: beacon is up-to-date. skipping update");
                                                    return [2 /*return*/];
                                                }
                                                deviation = delta
                                                    .mul(100 * Number(reservedParameters._times)) // TODO: can _times be null or 0?
                                                    .div(apiValue);
                                                console.log("Info: deviation %", deviation.toNumber() / Number(reservedParameters._times));
                                                tolerance = 5;
                                                if (deviation.lte(tolerance * Number(reservedParameters._times))) {
                                                    console.log("Info: delta between beacon and api value is within tolerance range. skipping update");
                                                    return [2 /*return*/];
                                                }
                                                sponsorWalletAddress = (0, wallet_1.deriveSponsorWallet)(ethers.utils.HDNode.fromMnemonic(config.nodeSettings.airnodeWalletMnemonic), airnodeWallet.address).address;
                                                // TODO: why can't we send encoded parameters to be forwarded to AirnodeRrp?
                                                // When using config.json.example we must pass a "from" parameter and the only
                                                // way to get this request to work is if we add it a fixedParameter in the node
                                                // config file
                                                return [4 /*yield*/, rrpBeaconServer
                                                        .connect(airnodeWallet)
                                                        .requestBeaconUpdate(templateId, airnodeWallet.address, sponsorWalletAddress)];
                                            case 4:
                                                // TODO: why can't we send encoded parameters to be forwarded to AirnodeRrp?
                                                // When using config.json.example we must pass a "from" parameter and the only
                                                // way to get this request to work is if we add it a fixedParameter in the node
                                                // config file
                                                _b.sent();
                                                return [2 /*return*/];
                                        }
                                    });
                                });
                            });
                            return [2 /*return*/];
                        });
                    }); });
                    return [2 /*return*/];
                });
            }); });
            response = { ok: true, data: { message: "Beacon update completed" } };
            return [2 /*return*/, { statusCode: 200, body: JSON.stringify(response) }];
        });
    });
};
exports.handler = handler;
