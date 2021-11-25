"use strict";
var __rest = (this && this.__rest) || function (s, e) {
    var t = {};
    for (var p in s) if (Object.prototype.hasOwnProperty.call(s, p) && e.indexOf(p) < 0)
        t[p] = s[p];
    if (s != null && typeof Object.getOwnPropertySymbols === "function")
        for (var i = 0, p = Object.getOwnPropertySymbols(s); i < p.length; i++) {
            if (e.indexOf(p[i]) < 0 && Object.prototype.propertyIsEnumerable.call(s, p[i]))
                t[p[i]] = s[p[i]];
        }
    return t;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.removeKey = exports.removeKeys = void 0;
function removeKeys(obj, keys) {
    return keys.reduce(function (acc, key) {
        return removeKey(acc, key);
    }, obj);
}
exports.removeKeys = removeKeys;
// lodash has an 'omit' function but it's quite slow
function removeKey(obj, key) {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    var _a = obj, _b = key, omit = _a[_b], rest = __rest(_a, [typeof _b === "symbol" ? _b : _b + ""]);
    return rest;
}
exports.removeKey = removeKey;
