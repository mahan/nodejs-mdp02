"use strict";

const spawn = require('child_process').spawn,
    path = require('path'),
    makeClient = require('../src/Client'),
    assert = require('assert');

let brokerProcess,
    workersProcesses,
    cwd = path.resolve(__dirname, '../');

function newProcess(file) {
    let childProc = spawn('node', [`tests/${file}`], {
        cwd: cwd
    });

    childProc.on('error', (err) => {
        console.log('Failed to start child process.', err);
    });

    childProc.stdout.on('data', (data) => {
        console.log(`${file}: ${data}`);
    });

    childProc.stderr.on('data', (data) => {
        console.error(`${file}: ${data}`);
    });
    return childProc
}

function newClient(client, cb) {
    return makeClient({
        address: "tcp://127.0.0.1:4242"
    });
}

describe("mdp02", function() {
    const concurrentWorkerSlowed = 5;
    before(function() {
        brokerProcess = newProcess("broker");
        workersProcesses = [
            newProcess("workerTime"),
            newProcess("workerHello"),
            newProcess("workerSingleton")
            // newProcess("workerSlowed")
        ];
        for (let i = 0; i < concurrentWorkerSlowed; i++) {
            workersProcesses.push(newProcess("workerSlowed"))
        }
    });

    describe("Client", function() {
        it("should call time service", function(cb) {
            const timeClient = newClient();
            timeClient.on(makeClient.events.EV_END, function(message) {
                assert(parseInt(message.data, 10) > 0);
                timeClient.stop();
                cb();
            });
            timeClient.on(makeClient.events.EV_ERR, function(err) {
                timeClient.stop();
                cb(err);
            });

            timeClient.start();
            timeClient.send("time");
        });

        it("should call hello service (chunked message)", function(cb) {
            let response = "";
            const helloClient = newClient();
            helloClient.on(makeClient.events.EV_DATA, function(message) {
                response += message.data;
            });
        
            helloClient.on(makeClient.events.EV_END, function() {
                const expected = "Hello world!";
                assert(response === expected, `got: "${response}" while expecting: "${expected}"`);
                helloClient.stop();
                cb();
            });
            helloClient.on(makeClient.events.EV_ERR, function(err) {
                helloClient.stop();
                cb(err.message + `Response is ${response}`);
            });
        
            helloClient.start();
            helloClient.send("sayhello", "world");
        });


    });

    describe("Worker", function () {
        it("should serve one response at a time", function(cb) {
            let responseCounter = 0,
                callTimes = 4,
                cbCalled,
                responses = [];


            function doClient() {
                let singletonCaller = newClient();
                singletonCaller.on(makeClient.events.EV_END, function(response) {
                    let responseData = parseInt(response.data);
                    responseCounter++;
                    assert(!responses.find((i) => responseData === i), `got: "${responseData}" duplicate ${JSON.stringify(responses)}`);
                    responses.push(responseData);
                    singletonCaller.stop();
                    if (responseCounter === callTimes && !cbCalled) {
                        cb();
                    }
                });
                singletonCaller.on(makeClient.events.EV_ERR, function(err) {
                    singletonCaller.stop();
                    cbCalled = true;
                    cb(err.message);
                });

                singletonCaller.start();
                singletonCaller.send("singleton");
            }

            for (let i = 0; i < callTimes; i++) {
                doClient();
            }

        });

        it("providing the same service should participate to client calls to reduce response time", function(cb) {
            let responseCounter = 0,
                cbCalled;

            function doClient() {
                let slowClient = newClient();
                slowClient.on(makeClient.events.EV_END, function(response) {
                    const expected = 1,
                        responseData = parseInt(response.data);
                    responseCounter++;
                    assert(responseData === expected, `got: "${responseData}" while expecting: "${expected}"`);
                    slowClient.stop();
                    if (responseCounter === concurrentWorkerSlowed && !cbCalled) {
                        cb();
                    }
                });
                slowClient.on(makeClient.events.EV_ERR, function(err) {
                    slowClient.stop();
                    cbCalled = true;
                    cb(err.message);
                });

                slowClient.start();
                slowClient.send("slowed");
            }

            for (let i = 0; i < concurrentWorkerSlowed; i++) {
                doClient();
            }

        });
    });

    after(function() {
        brokerProcess.kill('SIGTERM');
        workersProcesses.forEach(function(childProc) {
            if (childProc) {
                childProc.kill('SIGTERM');
            }
        });
    });
});
