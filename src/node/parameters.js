"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getReservedParameters = exports.getReservedParameterValue = exports.RESERVED_PARAMETERS = void 0;
var airnode_ois_1 = require("@api3/airnode-ois");
exports.RESERVED_PARAMETERS = Object.values(airnode_ois_1.ReservedParameterName);
function getReservedParameterValue(name, endpoint, requestParameters) {
    var reservedParameter = endpoint.reservedParameters.find(function (rp) { return rp.name === name; });
    // Reserved parameters must be whitelisted in order to be use, even if they have no
    // fixed or default value
    if (!reservedParameter) {
        return undefined;
    }
    if (reservedParameter.fixed) {
        return reservedParameter.fixed;
    }
    var requestParameter = requestParameters[name];
    if (!requestParameter) {
        return reservedParameter.default;
    }
    return requestParameter;
}
exports.getReservedParameterValue = getReservedParameterValue;
function getReservedParameters(endpoint, requestParameters) {
    var _path = getReservedParameterValue(airnode_ois_1.ReservedParameterName.Path, endpoint, requestParameters);
    var _times = getReservedParameterValue(airnode_ois_1.ReservedParameterName.Times, endpoint, requestParameters);
    var _type = getReservedParameterValue(airnode_ois_1.ReservedParameterName.Type, endpoint, requestParameters);
    var _relay_metadata = getReservedParameterValue(airnode_ois_1.ReservedParameterName.RelayMetadata, endpoint, requestParameters);
    return { _type: _type, _path: _path, _times: _times, _relay_metadata: _relay_metadata };
}
exports.getReservedParameters = getReservedParameters;
