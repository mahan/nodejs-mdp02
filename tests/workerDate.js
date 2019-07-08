"use strict";

const makeWorker = require('../src/Worker'),
    tcp3 = require("./addresses").tcp3;

const worker = makeWorker({
    serviceName: "date",
    address: tcp3
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    response.end(new Date().toJSON().slice(0, 10));
});

worker.start();