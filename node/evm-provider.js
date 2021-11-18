"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.buildEVMProvider = void 0;
var ethers_1 = require("ethers");
var networks_1 = require("./networks");
var constants_1 = require("./constants");
function buildEVMProvider(url, chainId) {
    // Ethers makes a call to get the network in the background if it is
    // not provided/undefined when initializing the provider. We keep
    // a list of "known" networks to stop these extra calls if possible.
    var network = networks_1.NETWORKS[chainId] || null;
    // Ethers only let's us configure the timeout when creating a provider
    return new ethers_1.ethers.providers.StaticJsonRpcProvider({ url: url, timeout: constants_1.EVM_PROVIDER_TIMEOUT }, network);
}
exports.buildEVMProvider = buildEVMProvider;
