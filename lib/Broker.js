"use strict";
/* global require */
/* global Buffer */

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

require('babel-polyfill');
var EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02');

var events = {
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
    var strategies = {};

    strategies[MDP02.C_REQUEST] = function (broker, socketId, frames) {
        if (frames.length < 3) {
            protocolError(broker);
        } else {
            var serviceName = frames[2].toString(),
                command = frames.slice(3);
            broker.emit(events.EV_REQ, { socketId: socketId, service: serviceName, data: command });
            broker.enqueueRequest(socketId, serviceName, command);
        }
    };

    strategies[events.EV_ERR] = function (broker, socketId, frames) {
        protocolError(broker, frames);
    };

    return strategies;
}

function prepareWorkerMessageStrategies() {
    var strategies = {};

    strategies[MDP02.W_HEARTBEAT] = function (broker, socketId, frames) {
        var worker = broker.workers[socketId];
        if (frames.length !== 2) {
            protocolError(broker, frames);
        } else {
            broker.emit(events.EV_HB, { socketId: socketId, service: worker.service });
            broker._sendHeartBeat(socketId);
        }
    };

    strategies[MDP02.W_DISCONNECT] = function (broker, socketId, frames) {
        var worker = broker.workers[socketId];
        if (frames.length !== 2) {
            protocolError(broker, frames);
        } else {
            broker.removeWorker(worker);
            broker.emit(events.EV_DISCONNECT, { socketId: socketId, service: worker.service });
        }
    };

    strategies[MDP02.W_READY] = function (broker, socketId, frames) {
        // let worker = broker.workers[socketId];
        if (frames.length !== 3) {
            protocolError(broker, frames);
        } else {
            var serviceName = frames[2].toString();
            broker.addWorker(socketId, serviceName);
            broker.emit(events.EV_WREADY, { socketId: socketId, service: serviceName });
            broker.fulfillRequests();
        }
    };

    strategies[MDP02.W_FINAL] = function (broker, socketId, frames) {
        var worker = broker.workers[socketId];
        if (frames.length >= 5) {
            var clientSocketId = JSON.stringify(frames[2]),
                data = frames.slice(4);
            broker.emit(events.EV_WFINAL, { socketId: socketId, service: worker.service, data: data });
            broker.socket.send([Buffer.from(JSON.parse(clientSocketId)), MDP02.CLIENT, MDP02.C_FINAL, worker.service, data]);
            broker.changeWorkerStatus(worker, READY);
            clientSocketId && delete broker.requests[clientSocketId];
            broker.fulfillRequests();
        } else {
            protocolError(broker, frames);
        }
    };

    strategies[MDP02.W_PARTIAL] = function (broker, socketId, frames) {
        var worker = broker.workers[socketId];
        if (frames.length >= 5) {
            var clientSocketId = JSON.stringify(frames[2]),
                data = frames.slice(4);
            broker.emit(events.EV_WPARTIAL, { socketId: socketId, service: worker.service, data: data });
            broker.socket.send([Buffer.from(JSON.parse(clientSocketId)), MDP02.CLIENT, MDP02.C_PARTIAL, worker.service, data]);
        } else {
            protocolError(broker, frames);
        }
    };
    strategies[events.EV_ERR] = function (broker, socketId, frames) {
        protocolError(broker, frames);
    };
    return strategies;
}

var WORKER_MESSAGE_STRATEGIES = prepareWorkerMessageStrategies(),
    CLIENT_MESSAGE_STRATEGIES = prepareClientMessageStrategies(undefined);

var Broker = function (_EventEmitter) {
    _inherits(Broker, _EventEmitter);

    function Broker() {
        _classCallCheck(this, Broker);

        return _possibleConstructorReturn(this, Object.getPrototypeOf(Broker).apply(this, arguments));
    }

    _createClass(Broker, [{
        key: 'emitErr',
        value: function emitErr(err) {
            var _this2 = this;

            setImmediate(function () {
                _this2.emit(events.EV_ERR, err);
            });
        }
    }, {
        key: 'send',
        value: function send(msg, partial) {
            this._sendMsg(msg, partial);
        }
    }, {
        key: 'start',
        value: function start() {
            var _this3 = this;

            if (this.socket) {
                return false;
            } else {
                this.socket = zmq.socket('router');
                this.workers = {};
                this.services = {};
                this.socket.on('message', function () {
                    for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                        args[_key] = arguments[_key];
                    }

                    _this3.emit(events.EV_MESSAGE, args);
                    try {
                        _this3._onMsg(args);
                    } catch (err) {
                        _this3.emitErr(err);
                    }
                });
                this.socket.on('error', function (err) {
                    _this3.emitErr(err);
                });
                this.addresses.forEach(function (addr) {
                    _this3.socket.bind(addr);
                });
                return true;
            }
        }
    }, {
        key: 'stop',
        value: function stop() {
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
    }, {
        key: '_onMsg',
        value: function _onMsg(rep) {
            this.cleanupWorkersAndRequests();
            var socketId = JSON.stringify(rep[0]),
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
    }, {
        key: '_onWorkerMsg',
        value: function _onWorkerMsg(socketId, frames) {
            var messageType = frames[1].toString(),
                worker = this.workers[socketId];
            if (worker || messageType === MDP02.W_READY) {
                var strategy = WORKER_MESSAGE_STRATEGIES[messageType];

                if (strategy !== undefined) {
                    if (worker !== undefined) worker.ts = Date.now();
                    strategy(this, socketId, frames);
                } else {
                    WORKER_MESSAGE_STRATEGIES[events.EV_ERR](this, socketId, frames);
                }
            }
        }
    }, {
        key: '_onClientMsg',
        value: function _onClientMsg(socketId, frames) {
            var messageType = frames[1].toString(),
                strategy = CLIENT_MESSAGE_STRATEGIES[messageType];

            if (strategy !== undefined) {
                strategy(this, socketId, frames);
            } else {
                CLIENT_MESSAGE_STRATEGIES[events.EV_ERR](this, socketId, frames);
            }
        }
    }, {
        key: 'changeWorkerStatus',
        value: function changeWorkerStatus(worker, ready) {
            var serviceName = worker.service,
                socketId = worker.socketId;
            if (ready === READY) {
                if (this.services[serviceName] === undefined) {
                    this.services[serviceName] = [socketId];
                } else {
                    this.services[serviceName].push(socketId);
                }
            } else if (ready === IN_USE && this.services[serviceName]) {
                var ixWorker = this.services[serviceName].indexOf(socketId);
                if (ixWorker >= 0) {
                    this.services[serviceName].splice(ixWorker, 1);
                }
            }
        }
    }, {
        key: '_sendHeartBeat',
        value: function _sendHeartBeat(socketId) {
            this.socket.send([Buffer.from(JSON.parse(socketId)), MDP02.WORKER, MDP02.W_HEARTBEAT]);
        }
    }, {
        key: '_sendDisconnect',
        value: function _sendDisconnect(socketId) {
            this.socket.send([Buffer.from(JSON.parse(socketId)), MDP02.WORKER, MDP02.W_DISCONNECT]);
        }
    }, {
        key: 'enqueueRequest',
        value: function enqueueRequest(socketId, serviceName, command) {
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
    }, {
        key: 'fulfillRequests',
        value: function fulfillRequests() {
            var _this4 = this;

            Object.keys(this.requests).forEach(function (socketId) {
                var request = _this4.requests[socketId];
                if (!request.served) {
                    _this4.serveRequest(request);
                }
            });
        }
    }, {
        key: 'serveRequest',
        value: function serveRequest(request) {
            var serviceName = request.service,
                worker = void 0;
            if (this.services[serviceName] && this.services[serviceName].length) {
                var socketId = this.services[serviceName][0];
                worker = this.workers[socketId];
                if (worker) {
                    this.changeWorkerStatus(worker, IN_USE);
                    request.served = true;
                    this.socket.send([Buffer.from(JSON.parse(worker.socketId)), MDP02.WORKER, MDP02.W_REQUEST, Buffer.from(JSON.parse(request.socketId)), ''].concat(request.message));
                }
            }
        }
    }, {
        key: 'addWorker',
        value: function addWorker(socketId, serviceName) {
            if (!this.workers[socketId]) {
                var worker = {
                    ts: Date.now(),
                    socketId: socketId,
                    service: serviceName
                };
                this.workers[socketId] = worker;
                this.changeWorkerStatus(worker, READY);
            }
        }
    }, {
        key: 'removeWorker',
        value: function removeWorker(worker) {
            this.changeWorkerStatus(worker, IN_USE);
            delete this.workers[worker.socketId];
        }
    }, {
        key: 'cleanupWorkersAndRequests',
        value: function cleanupWorkersAndRequests() {
            var _this5 = this;

            var now = Date.now(),
                currentClient = void 0,
                currentWorker = void 0,
                workerTimeout = this.workerTimeout,
                clientTimeout = this.clientTimeout;
            Object.keys(this.requests).forEach(function (socketId) {
                currentClient = _this5.requests[socketId];
                if (now - currentClient.ts > clientTimeout) {
                    delete _this5.requests[socketId];
                }
            });
            Object.keys(this.workers).forEach(function (socketId) {
                currentWorker = _this5.workers[socketId];
                if (now - currentWorker.ts > workerTimeout) {
                    _this5._sendDisconnect(socketId);
                    _this5.removeWorker(currentWorker);
                }
            });
        }
    }]);

    return Broker;
}(EventEmitter);

function makeBroker(props) {
    var broker = new Broker();
    Object.assign(broker, {
        workerTimeout: MDP02.TIMEOUT,
        clientTimeout: MDP02.TIMEOUT,
        requests: {},
        workers: {},
        services: {}
    }, props);

    ['SIGTERM', 'SIGINT', 'exit'].forEach(function (signal) {
        return process.on(signal, function () {
            return broker.stop();
        });
    });
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
//# sourceMappingURL=Broker.js.map
