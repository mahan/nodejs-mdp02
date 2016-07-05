"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "number",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;


    response.end(1234567890 + "");
});

worker.start();