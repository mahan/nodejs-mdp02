"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "sayhello",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response;
    response.write("Hello");
    response.write(" ");
    response.write(req.request.toString());
    response.end("!");
});

worker.start();