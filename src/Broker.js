"use strict";
/* global require */
/* global Buffer */

require('babel-polyfill');
const EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02');


const events = {
        EV_MESSAGE: 'message',
        EV_ERR: 'error',
        EV_REQ: 'request',
        EV_DISCONNECT: 'worker-disconnect',
        EV_CONNECT: 'worker-connect',
        EV_WREADY: 'worker-ready',
        EV_WBUSY: 'worker-busy'
    },
    READY = true,
    IN_USE = false;

function toUInt32(buff) {
    return buff.readUInt32BE(1);
}

function protocolError(broker, frames) {
    broker.emitErr(new MDP02.E_PROTOCOL('Wrong frames number'+ (frames && frames.length || 0)));
}

function workerProtocolError(broker, worker, frames) {
    broker.emitErr(new MDP02.E_PROTOCOL('Wrong frames number: ' + (frames && frames.length || 0)));
    broker.removeWorker(worker);
    broker._sendDisconnect(worker);
}

function prepareClientMessageStrategies() {
    let strategies = {};

    strategies[MDP02.C_REQUEST] = (broker, socket, bSocketId, frames) => {
        if (frames.length < 3) {
            protocolError(broker);
        } else {
            let serviceName = frames[2].toString(),
                command = frames.slice(3);

            broker.enqueueRequest(socket, bSocketId, serviceName, command);
            broker.emit(events.EV_REQ, {
                binding: socket.boundTo,
                service: serviceName,
                data: command
            });

        }
    };

    strategies[events.EV_ERR] = (broker, socket, bSocketId, frames) => {
        protocolError(broker, frames);
    };

    return strategies;
}

function prepareWorkerMessageStrategies() {
    let strategies = {};

    strategies[MDP02.W_HEARTBEAT] = (broker, socket, bSocketId, frames) => {
        let worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length !== 2) {
            workerProtocolError(broker, worker, frames);
        }
    };

    strategies[MDP02.W_DISCONNECT] = (broker, socket, bSocketId, frames) => {
        let worker = broker.workers[toUInt32(bSocketId)];
        broker.removeWorker(worker);
        if (frames.length !== 2) {
            protocolError(broker, worker, frames);
        } else {
            broker.emit(events.EV_DISCONNECT, {socketId: bSocketId, service: worker.service});
        }
    };

    strategies[MDP02.W_READY] = (broker, socket, bSocketId, frames) => {
        if (frames.length !== 3) {
            protocolError(broker, frames);
        } else {
            let serviceName = frames[2].toString();
            broker.addWorker(socket, bSocketId, serviceName);
            broker.emit(events.EV_CONNECT, {binding: socket.boundTo, service: serviceName});
            broker.fulfillRequests();
        }
    };

    strategies[MDP02.W_FINAL] = (broker, socket, bSocketId, frames) => {
        let worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length >= 5) {
            let bClientSocketId = frames[2],
                clientSocketId = toUInt32(bClientSocketId),
                data = frames.slice(4),
                request = broker.requests[clientSocketId];
            if (request) {
                request.socket.send([bClientSocketId, MDP02.CLIENT, MDP02.C_FINAL, worker.service, data]);
                broker.changeWorkerStatus(worker, READY);
                clientSocketId && delete broker.requests[clientSocketId];
            }
            broker.fulfillRequests();
        } else {
            workerProtocolError(broker, worker, frames);
        }
    };

    strategies[MDP02.W_PARTIAL] = (broker, socket, bSocketId, frames) => {
        let worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length >= 5) {
            let bClientSocketId = frames[2],
                clientSocketId = toUInt32(bClientSocketId),
                request = broker.requests[clientSocketId],
                data = frames.slice(4);
            if (request) {
                request.socket.send([bClientSocketId, MDP02.CLIENT, MDP02.C_PARTIAL, worker.service, data]);
            }
        } else {
            workerProtocolError(broker, worker, frames);
        }
    };
    strategies[events.EV_ERR] = (broker, socket, bSocketId, frames) => {
        let worker = broker.workers[toUInt32(bSocketId)];
        workerProtocolError(broker, worker, frames);
    };
    return strategies;
}

const WORKER_MESSAGE_STRATEGIES = prepareWorkerMessageStrategies(),
    CLIENT_MESSAGE_STRATEGIES = prepareClientMessageStrategies();

class Broker extends EventEmitter {

    emitErr(err) {
        setImmediate(() => {
            this.emit(events.EV_ERR, err);
        });
    }

    send(msg, partial) {
        this._sendMsg(msg, partial);
    }

    start() {
        if (this.sockets.length) {
            return false;
        } else {
            this.workers = {};
            this.services = {};

            this.bindings.forEach((addr) => {
                let socket = zmq.socket('router');
                this.sockets.push(socket);
                socket.bind(addr);
                socket.boundTo = addr;
                socket.on('message', (...args) => {
                    this.emit(events.EV_MESSAGE, args);
                    try {
                        this._onMsg(socket, args);
                    } catch (err) {
                        this.emitErr(err);
                    }
                });
                socket.on('error', (err) => {
                    this.emitErr(err);
                });
            });

            this._hbTimer = setInterval(() => {
                this.cleanupWorkersAndRequests();
            }, this.hbFrequence);
            return true;
        }
    }

    stop() {
        if (this.sockets.length) {
            clearInterval(this._hbTimer);
            this.requests = {};
            this.workers = {};
            this.services = {};

            this.sockets.forEach((socket) => {
                socket.removeAllListeners();
                socket.close();
            });
            this.sockets = [];
            delete this._currentClient;
        }
    }

    _onMsg(socket, rep) {
        let bSocketId = rep[0],
            frames = rep.slice(1),
            header = frames[0].toString();

        switch (header) {
            case MDP02.CLIENT:
                this._onClientMsg(socket, bSocketId, frames);
                break;
            case MDP02.WORKER:
                this._onWorkerMsg(socket, bSocketId, frames);
                break;
            default:
                protocolError(this, frames);
        }

    }

    _onWorkerMsg(socket, bSocketId, frames) {
        let messageType = frames[1].toString(),
            worker = this.workers[toUInt32(bSocketId)];
        if (worker || messageType === MDP02.W_READY) {
            let strategy = WORKER_MESSAGE_STRATEGIES[messageType];

            if (strategy !== undefined) {
                if (worker !== undefined) worker.ts = Date.now();
                strategy(this, socket, bSocketId, frames);
            } else {
                WORKER_MESSAGE_STRATEGIES[events.EV_ERR](this, socket, bSocketId, frames);
            }
        }
    }

    _onClientMsg(socket, bSocketId, frames) {
        let messageType = frames[1].toString(),
            strategy = CLIENT_MESSAGE_STRATEGIES[messageType];

        if (strategy !== undefined) {
            strategy(this, socket, bSocketId, frames);
        } else {
            CLIENT_MESSAGE_STRATEGIES[events.EV_ERR](this, socket, bSocketId, frames);
        }

    }

    changeWorkerStatus(worker, ready) {
        let serviceName = worker.service,
            socketId = toUInt32(worker.socketId);
        if (ready === READY) {
            if (this.services[serviceName] === undefined) {
                this.services[serviceName] = [socketId];
            } else {
                this.services[serviceName].push(socketId);
            }
            this.emit(events.EV_WREADY, {binding: worker.socket.boundTo, service: serviceName});
        } else if (ready === IN_USE && this.services[serviceName]) {
            let ixWorker = this.services[serviceName].indexOf(socketId);
            if (ixWorker >= 0) {
                this.services[serviceName].splice(ixWorker, 1);
            }
            this.emit(events.EV_WBUSY, {binding: worker.socket.boundTo, service: serviceName});
        }
    }

    _sendHeartBeat(worker) {
        worker.socket.send([
            worker.socketId,
            MDP02.WORKER,
            MDP02.W_HEARTBEAT
        ]);
    }

    _sendDisconnect(worker) {
        if (worker) {
            worker.socket.send([
                worker.socketId,
                MDP02.WORKER,
                MDP02.W_DISCONNECT
            ]);
        }
    }

    enqueueRequest(socket, bSocketId, serviceName, command) {
        let socketId = toUInt32(bSocketId);
        if (!this.requests[socketId]) {
            this.requests[socketId] = {
                ts: Date.now(),
                socket: socket,
                socketId: bSocketId,
                service: serviceName,
                message: command,
                served: false
            };
            setImmediate(() => this.fulfillRequests());
        }
    }

    fulfillRequests() {
        Object.keys(this.requests).forEach((socketId) => {
            let request = this.requests[socketId];
            if (!request.served) {
                this.serveRequest(request);
            }
        });
    }

    serveRequest(request) {
        let serviceName = request.service,
            worker;
        if (this.services[serviceName] && this.services[serviceName].length) {
            let socketId = this.services[serviceName][0];
            worker = this.workers[socketId];

            if (worker) {
                this.changeWorkerStatus(worker, IN_USE);
                request.served = true;
                worker.socket.send([
                    worker.socketId, MDP02.WORKER, MDP02.W_REQUEST,
                    request.socketId, ''
                ].concat(request.message));
            }
        }
    }

    addWorker(socket, bSocketId, serviceName) {
        let socketId = toUInt32(bSocketId);
        if (!this.workers[socketId]) {
            let worker = {
                ts: Date.now(),
                socket: socket,
                socketId: bSocketId,
                service: serviceName
            };
            this.workers[socketId] = worker;
            this.changeWorkerStatus(worker, READY);
        }
    }

    removeWorker(worker) {
        if (worker) {
            let socketId = worker.socketId,
                services = this.services[worker.service],
                servicePos = services.indexOf(toUInt32(socketId));
            if (servicePos >= 0) {
                services.splice(servicePos, 1);
            }
            delete this.workers[toUInt32(socketId)];
        }
    }

    cleanupWorkersAndRequests() {
        let now = Date.now(),
            currentClient, currentWorker,
            workerTimeout = this.workerTimeout,
            clientTimeout = this.clientTimeout;
        Object.keys(this.requests).forEach((socketId) => {
            currentClient = this.requests[socketId];
            if (now - currentClient.ts > clientTimeout) {
                delete this.requests[socketId];
            }
        });
        Object.keys(this.workers).forEach((socketId) => {
            currentWorker = this.workers[socketId];
            if (now - currentWorker.ts > workerTimeout) {
                this._sendDisconnect(currentWorker);
                this.removeWorker(currentWorker);
                this.emit(events.EV_DISCONNECT, {
                    socketId: currentWorker.socket.boundTo,
                    service: currentWorker.service
                });
            } else {
                this._sendHeartBeat(currentWorker);
            }
        });
    }

}

function makeBroker(props) {
    let broker = new Broker();
    Object.assign(broker, {
        workerTimeout: MDP02.TIMEOUT,
        clientTimeout: MDP02.TIMEOUT,
        requests: {},
        workers: {},
        services: {},
        sockets: []
    }, props);
    broker.hbFrequence = broker.hbFrequence || Math.trunc(broker.workerTimeout / 3);
    MDP02.addToProcessListener(() => broker.stop());
    return broker;
}

module.exports = makeBroker;
module.exports.events = events;