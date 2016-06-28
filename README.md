# MDP02

This is the implementation of the MDP written in ES6 and relying on [bindings](https://github.com/JustinTulloss/zeromq.node)
for node.js and io.js to [ZeroMQ](http://zeromq.org/)



The [Majordomo Protocol (MDP)](http://rfc.zeromq.org/spec:18) defines a reliable service-oriented request-reply dialog between a set of client
applications, a broker and a set of worker applications. MDP covers presence, heartbeating,
and service-oriented request-reply processing.


The goals of MDP are to
+ Allow requests to be routed to workers on the basis of abstract service names.
+ Allow both peers to detect disconnection of the other peer, through the use of heartbeating.
+ Allow the broker to implement a "least recently used" pattern for task distribution to workers for a given service.
+ Allow the broker to recover from dead or disconnected workers by resending requests to other workers.

This library is ideal for a distributed micro-services architecture where scalability and performance are
key features.

Broker, workers and clients, don't require a specific order to start and broker and workers can be
disconnected without breaking the request-response process, if the request timeout is respected.


## Broker

Broker is the central unit that has the task to dispatch messages between a Client originating a request
and a Worker that exposes a service and returns a response.

## Worker

Worker is a unit that serves synchronous request-response pairs for a given service.

A service is identified by its name, and a service may be served by more than a worker, a worker can serve
only a request a time.

## Client

Client is the request originator.
