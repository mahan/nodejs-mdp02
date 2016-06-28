"use strict";

Object.defineProperty(exports, "__esModule", {
    value: true
});
exports.TimeoutError = TimeoutError;
exports.ProtocolError = ProtocolError;
function TimeoutError(message) {
    this.message = message;
    this.stack = new Error().stack;
}
TimeoutError.prototype = new Error();
TimeoutError.prototype.name = 'TimeoutError';

function ProtocolError(message) {
    this.message = message;
    this.stack = new Error().stack;
}
ProtocolError.prototype = new Error();
ProtocolError.prototype.name = 'ProtocolError';
//# sourceMappingURL=errors.js.map
