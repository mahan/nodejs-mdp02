"use strict";

const makeWorker = require('../src/Worker'),
    fs = require('fs'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "fileTransfer",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function (req) {
    let response = req.response,
        readable = fs.createReadStream(req.request.toString()); //no exception handling
    readable.pipe(response);
});

worker.start();