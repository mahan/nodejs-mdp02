"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "time",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function () {
    worker.send(Date.now().toString());
});

worker.start();