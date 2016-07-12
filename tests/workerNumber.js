"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "number",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response,
        message = 1234567890;


    response.end(message.toString(10));
});

worker.start();