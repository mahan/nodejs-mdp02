"use strict";
/* global require */
require('babel-polyfill');

const errors = require('./errors');

const MDP02 = {
    WORKER: 'MDPW02',
    CLIENT: 'MDPC02',
    C_REQUEST: String.fromCharCode(0o01),
    C_PARTIAL: String.fromCharCode(0o02),
    C_FINAL: String.fromCharCode(0o03),
    W_READY: String.fromCharCode(0o01),
    W_REQUEST: String.fromCharCode(0o02),
    W_PARTIAL: String.fromCharCode(0o03),
    W_FINAL: String.fromCharCode(0o04),
    W_HEARTBEAT: String.fromCharCode(0o05),
    W_DISCONNECT: String.fromCharCode(0o06),
    TIMEOUT: 5000,
    HB_FREQUENCE: 1000,
    E_TIMEOUT: errors.TimeoutError,
    E_PROTOCOL: errors.ProtocolError,
    dumpFrames: function (frames, limit) {
        var result = '',
            i, frame,
            max = Math.min(frames.length, limit);

        for (i = 0; i < max; i++) {
            frame = frames[i];
            result += frame.toString('utf-8');
        }
        return result;
    }
};

let handlers = [];



['SIGTERM', 'SIGINT', 'exit'].forEach((signal) => {
    process.on(signal, () => {
        handlers.forEach((cb) => cb.call());
    });
});

module.exports = MDP02;

module.exports.addToProcessListener= function (cb) {
    handlers.push(cb);
};