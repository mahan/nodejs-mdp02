"use strict";

require('babel-polyfill');

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

module.exports.TimeoutError = TimeoutError;
module.exports.ProtocolError = ProtocolError;