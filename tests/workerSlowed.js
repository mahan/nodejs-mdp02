"use strict";

const makeWorker = require('../src/Worker');

const worker = makeWorker({
    serviceName: "slowed",
    address: "tcp://127.0.0.1:4242"
});

let calls = 0;

worker.on(makeWorker.events.EV_REQ, function (request) {
    calls++;
    setTimeout(() => worker.send(calls), 200);
});

worker.start();