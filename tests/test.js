"use strict";

const spawn = require('child_process').spawn,
    path = require('path'),
    fs = require('fs'),
    {tcp, tcp2, tcp3} = require("./addresses"),
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

function newClient(address) {
    return makeClient({
        address: address || tcp
    });
}

describe("mdp02", function() {
    const concurrentWorkerSlowed = 5;
    before(function() {
        brokerProcess = newProcess("broker");
        workersProcesses = [
            newProcess("workerNumber"),
            newProcess("workerHello"),
            newProcess("workerSingleton"),
            newProcess("workerDate"),
            newProcess("workerFileTransfer"),
            newProcess("workerNow")
        ];
        for (let i = 0; i < concurrentWorkerSlowed; i++) {
            workersProcesses.push(newProcess("workerSlowed"))
        }
    });

    describe("Client", function() {
        it("should call number service", function(cb) {

            this.timeout(5000);
            let timeClient = newClient();

            let response = timeClient.send("number"),
                message;

            response.on('data', function(chunk) {
                message = parseInt(chunk, 10);
            });

            response.on('end', function() {
                const expected = 1234567890;
                assert(message === expected, `got: ${message}, while expecting: ${expected}`);
                timeClient.stop();
                cb();
            });
        });

        it("should use stream to manage worker response", function(cb) {
            const expected = "Hello world!";

            this.timeout(5000);

            let helloClient = newClient(),
                response = helloClient.send("sayhello", "world"),
                message = '';

            response.on('data', function(chunk) {
                message += chunk.toString();
            });

            response.on('end', function() {
                assert(message === expected, `got: "${message}" while expecting: "${expected}"`);
                helloClient.stop();
                cb();
            });
        });

        it("can pipe response", function(cb) {
            const expected = "Hello world!";

            let helloClient = newClient(),
                fileName = path.resolve(cwd, 'tests', 'helloWorld.txt~'),
                testFile = fs.createWriteStream(fileName),
                response = helloClient.send("sayhello", "world");

            response.pipe(testFile);

            testFile.on('finish', function() {
                let message = fs.readFileSync(fileName, 'utf-8');
                assert(message === expected, `got: "${message}" while expecting: "${expected}"`);
                helloClient.stop();
                cb();
            });

        });

        it("can enqueue requests", function(cb) {
            this.timeout(15000);

            function makePromise() {
                //console.log('makePromise');
                return new Promise(function(resolve, reject) {
                    let client = newClient(),
                        response = client.send("now");
                    response.on('data', function(data) {
                        //console.log('makePromise 1');
                        resolve(parseInt(data, 10));
                    });
                    response.on('error', function(err) {
                        //console.log('makePromise 2');
                        reject(err);
                    });
                });
            }

            let p1 = makePromise(),
                p2 = makePromise(),
                p3 = makePromise();

            Promise.all([p1, p2, p3]).then(function (result) {
                let [r1, r2, r3] = result;

                assert(r1 < r2 < r3, `Resuts not in the correct order ${r1} < ${r2} < ${r3} ===  ${r1 < r2 < r3}`);
                cb();
            }).catch(cb);

        });

    });

    describe("Worker", function() {
        it("should serve one response at a time", function(cb) {
            let responseCounter = 0,
                callTimes = 4,
                cbCalled,
                responses = [];

            function doClient() {
                let singletonCaller = newClient();

                let response = singletonCaller.send("singleton");
                response.on('data', function(chunk) {
                    let responseData = parseInt(chunk, 10);
                    responseCounter++;
                    assert(!responses.find((i) => responseData === i), `got: "${responseData}" duplicate ${JSON.stringify(responses)}`);
                    responses.push(responseData);
                    singletonCaller.stop();
                    if (responseCounter === callTimes && !cbCalled) {
                        cb();
                    }
                });
                response.on('error', function(err) {
                    cbCalled = true;
                    cb(err.message);
                });
            }

            for (let i = 0; i < callTimes; i++) {
                doClient();
            }
        });

        it("providing the same service should participate to client calls to reduce response time", function(cb) {
            let responseCounter = 0,
                cbCalled;

            function doClient() {
                let startTime = Date.now(),
                    slowClient = newClient();

                let response = slowClient.send("slowed");
                response.on('data', function(chunk) {
                    const expected = 1,
                        responseData = parseInt(chunk);
                    responseCounter++;
                    assert(responseData === expected, `got: "${responseData}" while expecting: "${expected}"`);
                    slowClient.stop();
                    if (responseCounter === concurrentWorkerSlowed && !cbCalled) {
                        const elapsedTime = Date.now() - startTime,
                            maxTimeExpected = concurrentWorkerSlowed * 200;
                        assert(elapsedTime < maxTimeExpected, `got: "${elapsedTime}"more then expected: "${maxTimeExpected}"`);
                        cb();
                    }
                });
                response.on('error', function(err) {
                    slowClient.stop();
                    cbCalled = true;
                    cb(err.message);
                });

            }

            for (let i = 0; i < concurrentWorkerSlowed; i++) {
                doClient();
            }

        });

        it("should be able to send data piping streams", function(cb) {

            let helloClient = newClient(),
                fileName = path.resolve(cwd, 'tests', 'workerFileTransfer.js'),
                expected = fs.readFileSync(fileName).toString(),
                outFileName = fileName + '.cpy~',
                testFile = fs.createWriteStream(outFileName);

            let response = helloClient.send("fileTransfer", fileName);

            response.pipe(testFile);

            testFile.on('finish', function() {
                let message = fs.readFileSync(outFileName, 'utf-8').toString();
                assert(message === expected, `"${outFileName}"  differs from "${fileName}"`);
                helloClient.stop();
                cb();
            });

        });

    });

    describe("Broker", function() {
        it(`should serve using different sockets (client on ${tcp2}, worker on ${tcp})`, function(cb) {
            this.timeout(5000);

            let timeClient = newClient(tcp2),
                response = timeClient.send("number");
            response.on('data', function(chunk) {
                assert(parseInt(chunk, 10) === 1234567890);
                timeClient.stop();
                cb();
            });
            response.on('error', function() {
                timeClient.stop();
                cb(err);
            });
        });

        it("should work using tcp3 protocol", function(cb) {
            let today = new Date().toJSON().slice(0, 10),
                dateClient = newClient(tcp3);

            this.timeout(5000);

            let response = dateClient.send("date");
            response.on('data', function(chunk) {
                let result = chunk.toString();
                assert(result === today, `expected: '${today}', got: '${result}'`);
                dateClient.stop();
                cb();
            });
            response.on('error', function() {
                dateClient.stop();
                cb(err);
            });

        });

        it("should serve using different sockets (client on tcp, worker on tcp3)", function(cb) {

            this.timeout(5000);

            let today = new Date().toJSON().slice(0, 10),
                dateClient = newClient();

            let response = dateClient.send("date");

            response.on('data', function(chunk) {
                let result = chunk.toString();
                assert(result === today, `expected: '${today}', got: '${result}'`);
                dateClient.stop();
                cb();
            });
            response.on('error', function(err) {
                dateClient.stop();
                cb(err);
            });

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
