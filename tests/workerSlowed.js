"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "slowed",
    address: tcp
});

let calls = 0;

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    calls++;
    //console.log('slowed() - ' + makeWorker.events.EV_REQ + " " + calls);
    setTimeout(() => response.end(calls.toString(10)), 200);
});

worker.start();