"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safeDecode = void 0;
var airnode_abi_1 = require("@api3/airnode-abi");
function safeDecode(encodedParameters) {
    // It's unlikely that we'll have to deal with invalid parameters, but just in case,
    // wrap the decoding in a try/catch
    // eslint-disable-next-line functional/no-try-statement
    try {
        return (0, airnode_abi_1.decode)(encodedParameters);
    }
    catch (e) {
        return null;
    }
}
exports.safeDecode = safeDecode;
