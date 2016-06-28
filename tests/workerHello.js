"use strict";

const makeWorker = require('../src/Worker');

const worker = makeWorker({
    serviceName: "sayhello",
    address: "tcp://127.0.0.1:4242"
});

worker.on(makeWorker.events.EV_REQ, function (request) {
    worker.send("Hello", true);
    worker.send(" ", true);
    worker.send(request, true);
    worker.send("!");
});

worker.start();