# MDP02

## IMPORTANT: This is a clone of https://bitbucket.org/RedSoftwareSystems/nodejs-mdp02/src/master/ for my personal modifications and use.

This is the implementation of the MDP written in ES6 and relying on [bindings](https://github.com/JustinTulloss/zeromq.node)
for node.js and io.js to [ZeroMQ](http://zeromq.org/)



The [Majordomo Protocol (MDP)](http://rfc.zeromq.org/spec:18) defines a reliable service-oriented request-reply dialog between a set of client
applications, a broker and a set of worker applications.  
MDP covers presence, heartbeating, and service-oriented request-reply processing.  
This protocol is ideal for a multiprocess distributed microservice architecture.

![majordomo pattern](https://bitbucket.org/repo/Bqyj5y/images/4203151758-mdp.png)

The goals of MDP are to
* Allow requests to be routed to workers on the basis of abstract service names.
* Allow both peers to detect disconnection of the other peer, through the use of heartbeating.
* Allow the broker to implement a "least recently used" pattern for task distribution to workers for a given service.
* Allow the broker to recover from dead or disconnected workers by resending requests to other workers.

This library is ideal for a distributed micro-services architecture where scalability and performance are
key features.

Broker, workers and clients, don't require a specific order to start and broker and workers can be
disconnected without breaking the request-response process, if the request timeout is respected.


## Broker

Broker is the central unit that has the task to dispatch messages between a Client originating a request
and a Worker that exposes a service and returns a response.  
A broker can be bound to more than a single socket. The service can be provided by workers connected
to different end points.

```javascript
const broker = makeBroker({
    bindings: [
        "tcp://127.0.0.1:4242",
        "tcp://192.168.100.1:4243",
        "ipc:///tmp/mdp02-01"
    ]
});

broker.start();
```

## Worker

Worker is a unit that serves synchronous request-response pairs for a given service.

A service is identified by its name, and a **service may be served by more than a worker**, a worker can serve
only a request a time.

```javascript
const makeWorker = require('mdp02').makeWorker,
    fs = require('fs');

const worker = makeWorker({
    serviceName: "fileTransfer",
    address: "tcp://127.0.0.1:4242"
});

worker.on('request', function (req) {
    let response = req.response,
        readable = fs.createReadStream(req.request.toString()); //no exception handling
    readable.pipe(response);
});

worker.start();
```

## Client

Client is the request originator.  
Clients can execute a request at a time, requests sent are queued into Client internal buffer for sequential execution.  
On send method a stream is returned.

```javascript
const makeClient = require('mdp02').makeClient,
    fs = require('fs');

let helloClient = makeClient({address: "tcp://127.0.0.1:4242"}),
    fileName = path.resolve('remoteFile.txt'),
    outputFile = fs.createWriteStream('path-to-local-file.txt');

let response = helloClient.send("fileTransfer", fileName);

response.pipe(outputFile);

outputFile.on('finish', function() {
    helloClient.stop();
    doSomethingWithLocalFile();
});
```

## API

### Broker

Broker can be accessed with:
const makeBroker = require('mdp02').makeBroker;

**makeBroker(opts) -> Broker** is a function that returns a Broker instance.
A Broker is an instance of EventEmitter.

**_opts::Object{bindings, workerTimeout, clientTimeout}_**
* **bindings(required)**: Array of addresses to which the  Broker will be bound to.
    ex.: ['tcp://127.0.0.1:3333', 'ipc:///tmp/mdp02-01']
* **workerTimeout**: (default to 5000 msec) Timeout for which a connected worker
  is considered stale and unregistered. A disconnect message is sent to the worker,
  so that the worker will try to automatically disconnect and reconnect to the worker.
* **clientTimeout**: (default to 5000 msec) Timeout for which a client request is considered expired and removed form the request queue.
* **hbFrequence**: (default to 1/5 of workerTimeout) Frequence of heart beat, used to check connections with brokers and
clients ealth.
#### Worker Methods

 * **start** Binds the broker to the given addresses
 * **stop** Disconnects the broker and removes all listeners

#### Broker Events

> name: **'error'**, Event: Error<br>
Emitted on erros (soket or protocol errors)

> name: **'request'**, Event::Object{binding, service, command}<br>
Emitted when a request comes from a client.
* Event.binding: the binding address that received the request
* Event.service: the service name
* Event.command: the command request

> name: **'worker-connect'**, Event: Object{binding, service}<br>
Emitted when a worker is connected to the service pool.
* Event.binding: the binding address that received the request
* Event.service: the service name


> name: **'worker-ready'**, Event: Object{binding, service}<br>
Emitted when a worker is ready to serve a request.
* Event.binding: the binding address that received the request
* Event.service: the service name

> name: **'worker-busy'**, Event: Object{binding, service}<br>
Emitted when a worker is actually serving a request
* Event.binding: the binding address that received the request
* Event.service: the service name

> name: **'worker-disconnect'**, Event: Object{binding, service}<br>
Emitted when a worker is going to be disconnected from the broker
* Event.binding: the binding address that received the request
* Event.service: the service name


### Worker

Worker can be accessed with:
const makeWorker = require('mdp02').makeWorker;

**makeWorker(opts) -> Worker** is a function that returns a Worker instance.
A Worker is an instance of EventEmitter.

**_opts::Object{address, timeout, hbFrequence}_**
* **address(required)**: The address to use to connect to the Broker.
    ex.: 'tcp://127.0.0.1:3333'
* **timeout**: (default to 5000 msec) Timeout for which a broker
  is considered in stale. A disconnect message is sent to the broker and a restart
  action is performed.
* **hbFrequence**: (default to 1/5 of timeout) Frequence of heart beat, used to check connection/broker
ealth.

#### Worker Methods

* **start** Connects the worker to the Broker
* **stop** Disconnects the worker from the Broker

#### Worker Events

> name: **'error'**, Event: Error<br>
Emitted on erros (soket or protocol errors).

> name: **'request'**, Event: Object{response::Stream, request::Buffer|Buffer[]}<br>
Emitted when a worker receives a request from a Client through a broker
* Event.response: a [stream.Writable](https://nodejs.org/api/stream.html#stream_class_stream_writable) used to send the response back
* Event.request: the request message originated from the client

> name: **'close-request'**, Event: _null_<br>
Emitted when the worker has finished sennding back its reply

### Client

Client can be accessed with:
const makeWorker = require('mdp02').makeClient;

**makeClient(opts) -> Client** is a function that returns a Client instance.
A Client enqueue requests for the desired services and obtain responses in the
give order.

```javascript
function newClient(address) {
    return makeClient({
        address: 'tcp://127.0.0.1:3333'
    });
}

function makePromise() {
    return new Promise(function(resolve, reject) {
        let client = newClient(),
            response = client.send("now");
        response.on('data', function(data) {
            console.log('received', data);
        });

        response.on('end', function(data) {
            resolve(parseInt(data, 10));
        });
        response.on('error', function(err) {
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
});
```

* **address(required)**: The address to use to connect to the Broker.
    ex.: 'tcp://127.0.0.1:3333'
* **timeout**: (default to 5000 msec) Timeout for which a client
  is considered in stale. A retry is performed in case.
* **maxRetries** Number of time ca client can try a request.
Must be grater than 1 (default is 3). If  the number of tries exceeds this limit
an error event is emitted and the enqueued requests are discarded

#### Client Properties



#### Client Methods

> **send(service::String, message::String|Buffer|String[]|Buffer[]) -> [stream.Readable](https://nodejs.org/api/stream.html#stream_class_stream_readable)** Send a request for a service and returns
a stream.Readeable.
* **service(required)**: The service name to call
* **message**: The message to send to the desired service. Can be a String, Buffer or an array of strings or buffers.

> **stop** Disconnects the client from the Broker and resets the request queue

1) _workers, clients and broker timeouts should match to avoid false error handling_
