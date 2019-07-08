"use strict";

const makeBroker = require('../src/Broker'),
    {tcp, tcp2, tcp3} = require("./addresses");

const broker = makeBroker({
    bindings: [
        tcp,
        tcp2,
        tcp3
    ]
});

broker.on('error', (err) => {
    console.error('err: ',err);
});
broker.start();
