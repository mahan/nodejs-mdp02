"use strict";

const makeWorker = require('../src/Worker'),
    ipc = require("./addresses").ipc;

const worker = makeWorker({
    serviceName: "now",
    address: ipc
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    response.end(Date.now().toString(10));
});

worker.start();