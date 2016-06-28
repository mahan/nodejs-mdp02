"use strict";

const makeBroker = require('../src/Broker'),
    {tcp, tcp2, ipc} = require("./addresses");

const broker = makeBroker({
    addresses: [
        tcp,
        tcp2,
        ipc
    ]
});

broker.start();
