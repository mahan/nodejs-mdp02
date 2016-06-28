"use strict";

const makeBroker = require('../src/Broker');

const broker = makeBroker({
    addresses: [
        "tcp://127.0.0.1:4242"
    ]
});

broker.start();
