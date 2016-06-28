"use strict";

const makeWorker = require('../src/Worker');

const worker = makeWorker({
    serviceName: "time",
    address: "tcp://127.0.0.1:4242"
});

worker.on(makeWorker.events.EV_REQ, function () {
    worker.send(Date.now().toString());
});

worker.start();