"use strict";

const makeWorker = require('../src/Worker'),
    tcp = require("./addresses").tcp;

const worker = makeWorker({
    serviceName: "sayhello",
    address: tcp
});

worker.on(makeWorker.events.EV_REQ, function (request) {
    worker.send("Hello", true);
    worker.send(" ", true);
    worker.send(request, true);
    worker.send("!");
});

worker.start();