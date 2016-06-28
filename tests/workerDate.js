"use strict";

const makeWorker = require('../src/Worker'),
    ipc = require("./addresses").ipc;

const worker = makeWorker({
    serviceName: "date",
    address: ipc
});

worker.on(makeWorker.events.EV_REQ, function () {
    worker.send(new Date().toJSON().slice(0, 10));
});

worker.start();