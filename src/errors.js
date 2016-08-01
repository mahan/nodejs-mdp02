"use strict";

require('babel-polyfill');

class TimeoutError extends Error {
    constructor(message) {
        super(message);
        this.name = 'TimeoutError';
    }
}

class ProtocolError extends Error {
    constructor(message) {
        super(message);
        this.name = 'ProtocolError';
    }
}

module.exports.TimeoutError = TimeoutError;
module.exports.ProtocolError = ProtocolError;