"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "singleton",
    address: tcp
});

let calls = 0;

worker.on(makeWorker.events.EV_REQ, function (request) {
    calls++;
    setTimeout(() => worker.send(calls), 200);
});

worker.start();