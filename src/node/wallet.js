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
Object.defineProperty(exports, "__esModule", { value: true });
exports.deriveSponsorWallet = exports.getAirnodeAddressShort = exports.getExtendedPublicKey = exports.getAirnodeWallet = exports.getMasterHDNode = exports.deriveWalletPathFromSponsorAddress = void 0;
var ethers_1 = require("ethers");
var node = __importStar(require("@api3/airnode-node"));
/**
 * HD wallets allow us to create multiple accounts from a single mnemonic.
 * Each sponsor creates a designated wallet for each provider to use
 * in order for them to be able to respond to the requests their requesters make.
 *
 * By convention derivation paths start with a master index
 * followed by child indices that can be any integer up to 2^31.
 *
 * Since addresses can be represented as 160bits (20bytes) we can then
 * split it in chunks of 31bits and create a path with the following pattern:
 * 0/1st31bits/2nd31bits/3rd31bits/4th31bits/5th31bits/6th31bits.
 *
 * @param sponsorAddress A string representing a 20bytes hex address
 * @returns The path derived from the address
 */
var deriveWalletPathFromSponsorAddress = function (sponsorAddress) {
    var sponsorAddressBN = ethers_1.ethers.BigNumber.from(ethers_1.ethers.utils.getAddress(sponsorAddress));
    var paths = [];
    // eslint-disable-next-line functional/no-let, functional/no-loop-statement
    for (var i = 0; i < 6; i++) {
        var shiftedSponsorAddressBN = sponsorAddressBN.shr(31 * i);
        paths.push(shiftedSponsorAddressBN.mask(31).toString());
    }
    return "0/" + paths.join("/");
};
exports.deriveWalletPathFromSponsorAddress = deriveWalletPathFromSponsorAddress;
function getMasterHDNode(config) {
    var mnemonic = node.config.getMasterKeyMnemonic(config);
    return ethers_1.ethers.utils.HDNode.fromMnemonic(mnemonic);
}
exports.getMasterHDNode = getMasterHDNode;
function getAirnodeWallet(config) {
    var mnemonic = node.config.getMasterKeyMnemonic(config);
    return ethers_1.ethers.Wallet.fromMnemonic(mnemonic);
}
exports.getAirnodeWallet = getAirnodeWallet;
function getExtendedPublicKey(masterHDNode) {
    return masterHDNode.derivePath("m/44'/60'/0'").neuter().extendedKey;
}
exports.getExtendedPublicKey = getExtendedPublicKey;
function getAirnodeAddressShort(airnodeAddress) {
    // NOTE: AWS doesn't allow uppercase letters in S3 bucket and lambda function names
    return airnodeAddress.substring(2, 9).toLowerCase();
}
exports.getAirnodeAddressShort = getAirnodeAddressShort;
function deriveSponsorWallet(masterHDNode, sponsorAddress) {
    var sponsorWalletHdNode = masterHDNode.derivePath("m/44'/60'/0'/" + (0, exports.deriveWalletPathFromSponsorAddress)(sponsorAddress));
    return new ethers_1.ethers.Wallet(sponsorWalletHdNode.privateKey);
}
exports.deriveSponsorWallet = deriveSponsorWallet;
