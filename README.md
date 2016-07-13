# MDP02

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
    addresses: [
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
const makeWorker = require('mdp02/Worker'),
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
const makeClient = require('mdp02/Client'),
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
const makeBroker = require('mdp02/Broker');

**makeBroker(opts) -> Broker** is a function that returns a Broker instance.
A Broker is an instance of EventEmitter.

**_opts::Object{bindings, workerTimeout, clientTimeout}_**
* **bindings(required)**: Array of addresses to which the  Broker will be bound to.
    ex.: ['tcp://127.0.0.1:3333', 'ipc:///tmp/mdp02-01']
* **workerTimeout**: (default to 5000 msec) Timeout for which a connected worker
  is considered stale and unregistered. A disconnect message is sent to the worker,
  so that the worker will try to automatically disconnect and reconnect to the worker.
* **clientTimeout**: (default to 5000 msec) Timeout for which a client request is considered expired and removed form the request queue.

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
const makeWorker = require('mdp02/Worker');

**makeWorker(opts) -> Worker** is a function that returns a Worker instance.
A Worker is an instance of EventEmitter.

**_opts::Object{address, timeout, hbFrequence}_**
* **address(required)**: The address to use to connect to the Broker.
    ex.: 'tcp://127.0.0.1:3333'
* **timeout**: (default to 5000 msec) Timeout for which a broker
  is considered in stale. A disconnect message is sent to the broker and a restart
  action is performed.
* **hbFrequence**: (default to 1000 msec) Frequence of heart beat, used to check connection/broker
heath.

#### Worker Methods

* **start** Connects the worker to the Broker
* **stop** Disconnects the worker from the Broker

#### Worker Events

> name: **'request'**, Event: Object{response::Stream, request::Buffer}<br>
Emitted when a worker receives a request from a Client through a broker
* Event.response: a stream used to send the response back
* Event.request: the request message originated from the client

> name: **'close-request'**, Event: _null_<br>
Emitted when the worker has finished sennding back its reply
