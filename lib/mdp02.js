"use strict";
/* global require */

var errors = require('./errors');

var MDP02 = {
    WORKER: 'MDPW02',
    CLIENT: 'MDPC02',
    C_REQUEST: String.fromCharCode(1),
    C_PARTIAL: String.fromCharCode(2),
    C_FINAL: String.fromCharCode(3),
    W_READY: String.fromCharCode(1),
    W_REQUEST: String.fromCharCode(2),
    W_PARTIAL: String.fromCharCode(3),
    W_FINAL: String.fromCharCode(4),
    W_HEARTBEAT: String.fromCharCode(5),
    W_DISCONNECT: String.fromCharCode(6),
    TIMEOUT: 5000,
    HB_FREQUENCE: 1000,
    E_TIMEOUT: errors.TimeoutError,
    E_PROTOCOL: errors.ProtocolError,
    dumpFrames: function dumpFrames(frames, limit) {
        var result = '',
            i,
            frame,
            max = Math.min(frames.length, limit);

        for (i = 0; i < max; i++) {
            frame = frames[i];
            result += frame.toString('utf-8');
        }
        return result;
    }
};

module.exports = MDP02;
//# sourceMappingURL=mdp02.js.map
