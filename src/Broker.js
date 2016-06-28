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
        EV_HB: 'heartbeat',
        EV_DISCONNECT: 'worker-disconnect',
        EV_WREADY: 'worker-ready',
        EV_WFINAL: 'worker-final-data',
        EV_WPARTIAL: 'worker-partial-data',
        EV_RES: 'response'
    },
    READY = true,
    IN_USE = false;

function protocolError(broker, frames) {
    broker.emitErr(new MDP02.E_PROTOCOL('Wrong frames number', frames));
}

function prepareClientMessageStrategies() {
    let strategies = {};

    strategies[MDP02.C_REQUEST] = (broker, socketId, frames) => {
        if (frames.length < 3) {
            protocolError(broker);
        } else {
            let serviceName = frames[2].toString(),
                command = frames.slice(3);
            broker.emit(events.EV_REQ, {socketId: socketId, service: serviceName, data: command});
            broker.enqueueRequest(socketId, serviceName, command);
        }
    };

    strategies[events.EV_ERR] = (broker, socketId, frames) => {
        protocolError(broker, frames);
    };

    return strategies;
}

function prepareWorkerMessageStrategies() {
    let strategies = {};

    strategies[MDP02.W_HEARTBEAT] = (broker, socketId, frames) => {
        let worker = broker.workers[socketId];
        if (frames.length !== 2) {
            protocolError(broker, frames);
        } else {
            broker.emit(events.EV_HB, {socketId: socketId, service: worker.service});
            broker._sendHeartBeat(socketId);
        }
    };

    strategies[MDP02.W_DISCONNECT] = (broker, socketId, frames) => {
        let worker = broker.workers[socketId];
        if (frames.length !== 2) {
            protocolError(broker, frames);
        } else {
            broker.removeWorker(worker);
            broker.emit(events.EV_DISCONNECT, {socketId: socketId, service: worker.service});
        }
    };

    strategies[MDP02.W_READY] = (broker, socketId, frames) => {
        // let worker = broker.workers[socketId];
        if (frames.length !== 3) {
            protocolError(broker, frames);
        } else {
            let serviceName = frames[2].toString();
            broker.addWorker(socketId, serviceName);
            broker.emit(events.EV_WREADY, {socketId: socketId, service: serviceName});
            broker.fulfillRequests();
        }
    };

    strategies[MDP02.W_FINAL] = (broker, socketId, frames) => {
        let worker = broker.workers[socketId];
        if (frames.length >= 5) {
            let clientSocketId = JSON.stringify(frames[2]),
                data = frames.slice(4);
            broker.emit(events.EV_WFINAL, {socketId: socketId, service: worker.service, data: data});
            broker.socket.send([Buffer.from(JSON.parse(clientSocketId)), MDP02.CLIENT, MDP02.C_FINAL, worker.service, data]);
            broker.changeWorkerStatus(worker, READY);
            clientSocketId && delete broker.requests[clientSocketId];
            broker.fulfillRequests();
        } else {
            protocolError(broker, frames);
        }
    };

    strategies[MDP02.W_PARTIAL] = (broker, socketId, frames) => {
        let worker = broker.workers[socketId];
        if (frames.length >= 5) {
            let clientSocketId = JSON.stringify(frames[2]),
                data = frames.slice(4);
            broker.emit(events.EV_WPARTIAL, {socketId: socketId, service: worker.service, data: data});
            broker.socket.send([Buffer.from(JSON.parse(clientSocketId)), MDP02.CLIENT, MDP02.C_PARTIAL, worker.service, data]);
        } else {
            protocolError(broker, frames);
        }
    };
    strategies[events.EV_ERR] = (broker, socketId, frames) => {
        protocolError(broker, frames);
    };
    return strategies;
}

const WORKER_MESSAGE_STRATEGIES = prepareWorkerMessageStrategies(),
    CLIENT_MESSAGE_STRATEGIES = prepareClientMessageStrategies(this);

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
        if (this.socket) {
            return false;
        } else {


            this.socket = zmq.socket('router');
            this.workers = {};
            this.services = {};
            this.socket.on('message', (...args) => {
                this.emit(events.EV_MESSAGE, args);
                try {
                    this._onMsg(args);
                } catch (err) {
                    this.emitErr(err);
                }
            });
            this.socket.on('error', (err) => {
                this.emitErr(err);
            });
            this.addresses.forEach((addr) => {
                this.socket.bind(addr);
            });
            return true;
        }
    }

    stop() {
        if (this.socket) {
            this.requests = {};
            this.workers = {};
            this.services = {};
            this.socket.removeAllListeners();
            this.socket.close();
            delete this.socket;
            delete this._currentClient;
        }
    }

    _onMsg(rep) {

        this.cleanupWorkersAndRequests();
        let socketId = JSON.stringify(rep[0]),
            frames = rep.slice(1),
            header = frames[0].toString();
        switch (header) {
            case MDP02.CLIENT:
                this._onClientMsg(socketId, frames);
                break;
            case MDP02.WORKER:
                this._onWorkerMsg(socketId, frames);
                break;
            default:
                protocolError(this, frames);
        }

    }

    _onWorkerMsg(socketId, frames) {
        let messageType = frames[1].toString(),
            worker = this.workers[socketId];
        if (worker || messageType === MDP02.W_READY) {
            let strategy = WORKER_MESSAGE_STRATEGIES[messageType];

            if (strategy !== undefined) {
                if (worker !== undefined) worker.ts = Date.now();
                strategy(this, socketId, frames);
            } else {
                WORKER_MESSAGE_STRATEGIES[events.EV_ERR](this, socketId, frames)
            }
        }
    }

    _onClientMsg(socketId, frames) {
        let messageType = frames[1].toString(),
            strategy = CLIENT_MESSAGE_STRATEGIES[messageType];

        if (strategy !== undefined) {
            strategy(this, socketId, frames);
        } else {
            CLIENT_MESSAGE_STRATEGIES[events.EV_ERR](this, socketId, frames)
        }

    }

    changeWorkerStatus(worker, ready) {
        let serviceName = worker.service,
            socketId = worker.socketId;
        if (ready === READY) {
            if (this.services[serviceName] === undefined) {
                this.services[serviceName] = [socketId];
            } else {
                this.services[serviceName].push(socketId);
            }
        } else if (ready === IN_USE && this.services[serviceName]) {
            let ixWorker = this.services[serviceName].indexOf(socketId);
            if (ixWorker >= 0) {
                this.services[serviceName].splice(ixWorker, 1);
            }
        }
    }

    _sendHeartBeat(socketId) {
        this.socket.send([
            Buffer.from(JSON.parse(socketId)),
            MDP02.WORKER,
            MDP02.W_HEARTBEAT
        ]);
    }

    _sendDisconnect(socketId) {
        this.socket.send([
            Buffer.from(JSON.parse(socketId)),
            MDP02.WORKER,
            MDP02.W_DISCONNECT
        ]);
    }

    enqueueRequest(socketId, serviceName, command) {
        if (!this.requests[socketId]) {
            this.requests[socketId] = {
                ts: Date.now(),
                socketId: socketId,
                service: serviceName,
                message: command,
                served: false
            };
            this.fulfillRequests();
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
                this.socket.send([
                    Buffer.from(JSON.parse(worker.socketId)), MDP02.WORKER, MDP02.W_REQUEST,
                    Buffer.from(JSON.parse(request.socketId)), ''
                ].concat(request.message));
            }
        }
    }

    addWorker(socketId, serviceName) {
        if (!this.workers[socketId]) {
            let worker = {
                ts: Date.now(),
                socketId: socketId,
                service: serviceName
            };
            this.workers[socketId] = worker;
            this.changeWorkerStatus(worker, READY);
        }
    }

    removeWorker(worker) {
        this.changeWorkerStatus(worker, IN_USE);
        delete this.workers[worker.socketId];
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
                this._sendDisconnect(socketId);
                this.removeWorker(currentWorker);
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
        services: {}
    }, props);

    MDP02.addToProcessListener(() => broker.stop());
    return broker;
}

module.exports = makeBroker;
module.exports.events = events;



// Object.defineProperties(Broker, {
//     workerTimeout: {
//         value: MDP02.TIMEOUT,
//         writable: true
//     },
//     clientTimeout: {
//         value: MDP02.TIMEOUT,
//         writable: true
//     }
// });
