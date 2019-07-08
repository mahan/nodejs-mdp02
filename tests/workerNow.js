"use strict";

const makeWorker = require('../src/Worker'),
    tcp2 = require("./addresses").tcp2;

const worker = makeWorker({
    serviceName: "now",
    address: tcp2
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    response.end(Date.now().toString(10));
});

worker.start();