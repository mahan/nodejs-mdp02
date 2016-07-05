"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "singleton",
    address: tcp
});

let calls = 0;

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    calls++;
    setTimeout(() => response.end(calls + ""), 200);
});

worker.start();