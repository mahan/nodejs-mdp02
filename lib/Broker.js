"use strict";
/* global require */
/* global Buffer */

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

require('babel-polyfill');
var EventEmitter = require('events'),
    zmq = require('zeromq'),
    MDP02 = require('./mdp02');

var events = {
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
    broker.emitErr(new MDP02.E_PROTOCOL('Wrong frames number' + (frames && frames.length || 0)));
}

function workerProtocolError(broker, worker, frames) {
    broker.emitErr(new MDP02.E_PROTOCOL('Wrong frames number: ' + (frames && frames.length || 0)));
    broker.removeWorker(worker);
    broker._sendDisconnect(worker);
}

function prepareClientMessageStrategies() {
    var strategies = {};

    strategies[MDP02.C_REQUEST] = function (broker, socket, bSocketId, frames) {
        if (frames.length < 3) {
            protocolError(broker);
        } else {
            var serviceName = frames[2].toString(),
                command = frames.slice(3);

            broker.enqueueRequest(socket, bSocketId, serviceName, command);
            broker.emit(events.EV_REQ, {
                binding: socket.boundTo,
                service: serviceName,
                data: command
            });
        }
    };

    strategies[events.EV_ERR] = function (broker, socket, bSocketId, frames) {
        protocolError(broker, frames);
    };

    return strategies;
}

function prepareWorkerMessageStrategies() {
    var strategies = {};

    strategies[MDP02.W_HEARTBEAT] = function (broker, socket, bSocketId, frames) {
        var worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length !== 2) {
            workerProtocolError(broker, worker, frames);
        }
    };

    strategies[MDP02.W_DISCONNECT] = function (broker, socket, bSocketId, frames) {
        var worker = broker.workers[toUInt32(bSocketId)];
        broker.removeWorker(worker);
        if (frames.length !== 2) {
            protocolError(broker, worker, frames);
        } else {
            broker.emit(events.EV_DISCONNECT, { socketId: bSocketId, service: worker.service });
        }
    };

    strategies[MDP02.W_READY] = function (broker, socket, bSocketId, frames) {
        if (frames.length !== 3) {
            protocolError(broker, frames);
        } else {
            var serviceName = frames[2].toString();
            broker.addWorker(socket, bSocketId, serviceName);
            broker.emit(events.EV_CONNECT, { binding: socket.boundTo, service: serviceName });
            broker.fulfillRequests();
        }
    };

    strategies[MDP02.W_FINAL] = function (broker, socket, bSocketId, frames) {
        var worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length >= 5) {
            var bClientSocketId = frames[2],
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

    strategies[MDP02.W_PARTIAL] = function (broker, socket, bSocketId, frames) {
        var worker = broker.workers[toUInt32(bSocketId)];
        if (frames.length >= 5) {
            var bClientSocketId = frames[2],
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
    strategies[events.EV_ERR] = function (broker, socket, bSocketId, frames) {
        var worker = broker.workers[toUInt32(bSocketId)];
        workerProtocolError(broker, worker, frames);
    };
    return strategies;
}

var WORKER_MESSAGE_STRATEGIES = prepareWorkerMessageStrategies(),
    CLIENT_MESSAGE_STRATEGIES = prepareClientMessageStrategies();

var Broker = function (_EventEmitter) {
    _inherits(Broker, _EventEmitter);

    function Broker() {
        _classCallCheck(this, Broker);

        return _possibleConstructorReturn(this, (Broker.__proto__ || Object.getPrototypeOf(Broker)).apply(this, arguments));
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

            if (this.sockets.length) {
                return false;
            } else {
                this.workers = {};
                this.services = {};

                this.bindings.forEach(function (addr) {
                    var socket = zmq.socket('router');
                    _this3.sockets.push(socket);
                    socket.bind(addr);
                    socket.boundTo = addr;
                    socket.on('message', function () {
                        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                            args[_key] = arguments[_key];
                        }

                        _this3.emit(events.EV_MESSAGE, args);
                        try {
                            _this3._onMsg(socket, args);
                        } catch (err) {
                            _this3.emitErr(err);
                        }
                    });
                    socket.on('error', function (err) {
                        _this3.emitErr(err);
                    });
                });

                this._hbTimer = setInterval(function () {
                    _this3.cleanupWorkersAndRequests();
                }, this.hbFrequence);
                return true;
            }
        }
    }, {
        key: 'stop',
        value: function stop() {
            if (this.sockets.length) {
                clearInterval(this._hbTimer);
                this.requests = {};
                this.workers = {};
                this.services = {};

                this.sockets.forEach(function (socket) {
                    socket.removeAllListeners();
                    socket.close();
                });
                this.sockets = [];
                delete this._currentClient;
            }
        }
    }, {
        key: '_onMsg',
        value: function _onMsg(socket, rep) {
            var bSocketId = rep[0],
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
    }, {
        key: '_onWorkerMsg',
        value: function _onWorkerMsg(socket, bSocketId, frames) {
            var messageType = frames[1].toString(),
                worker = this.workers[toUInt32(bSocketId)];
            if (worker || messageType === MDP02.W_READY) {
                var strategy = WORKER_MESSAGE_STRATEGIES[messageType];

                if (strategy !== undefined) {
                    if (worker !== undefined) worker.ts = Date.now();
                    strategy(this, socket, bSocketId, frames);
                } else {
                    WORKER_MESSAGE_STRATEGIES[events.EV_ERR](this, socket, bSocketId, frames);
                }
            }
        }
    }, {
        key: '_onClientMsg',
        value: function _onClientMsg(socket, bSocketId, frames) {
            var messageType = frames[1].toString(),
                strategy = CLIENT_MESSAGE_STRATEGIES[messageType];

            if (strategy !== undefined) {
                strategy(this, socket, bSocketId, frames);
            } else {
                CLIENT_MESSAGE_STRATEGIES[events.EV_ERR](this, socket, bSocketId, frames);
            }
        }
    }, {
        key: 'changeWorkerStatus',
        value: function changeWorkerStatus(worker, ready) {
            var serviceName = worker.service,
                socketId = toUInt32(worker.socketId);
            if (ready === READY) {
                if (this.services[serviceName] === undefined) {
                    this.services[serviceName] = [socketId];
                } else {
                    this.services[serviceName].push(socketId);
                }
                this.emit(events.EV_WREADY, { binding: worker.socket.boundTo, service: serviceName });
            } else if (ready === IN_USE && this.services[serviceName]) {
                var ixWorker = this.services[serviceName].indexOf(socketId);
                if (ixWorker >= 0) {
                    this.services[serviceName].splice(ixWorker, 1);
                }
                this.emit(events.EV_WBUSY, { binding: worker.socket.boundTo, service: serviceName });
            }
        }
    }, {
        key: '_sendHeartBeat',
        value: function _sendHeartBeat(worker) {
            worker.socket.send([worker.socketId, MDP02.WORKER, MDP02.W_HEARTBEAT]);
        }
    }, {
        key: '_sendDisconnect',
        value: function _sendDisconnect(worker) {
            if (worker) {
                worker.socket.send([worker.socketId, MDP02.WORKER, MDP02.W_DISCONNECT]);
            }
        }
    }, {
        key: 'enqueueRequest',
        value: function enqueueRequest(socket, bSocketId, serviceName, command) {
            var _this4 = this;

            var socketId = toUInt32(bSocketId);
            if (!this.requests[socketId]) {
                this.requests[socketId] = {
                    ts: Date.now(),
                    socket: socket,
                    socketId: bSocketId,
                    service: serviceName,
                    message: command,
                    served: false
                };
                setImmediate(function () {
                    return _this4.fulfillRequests();
                });
            }
        }
    }, {
        key: 'fulfillRequests',
        value: function fulfillRequests() {
            var _this5 = this;

            Object.keys(this.requests).forEach(function (socketId) {
                var request = _this5.requests[socketId];
                if ((typeof request !== 'undefined') && (!request.served)) {
                    _this5.serveRequest(request);
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
                    worker.socket.send([worker.socketId, MDP02.WORKER, MDP02.W_REQUEST, request.socketId, ''].concat(request.message));
                }
            }
        }
    }, {
        key: 'addWorker',
        value: function addWorker(socket, bSocketId, serviceName) {
            var socketId = toUInt32(bSocketId);
            if (!this.workers[socketId]) {
                var worker = {
                    ts: Date.now(),
                    socket: socket,
                    socketId: bSocketId,
                    service: serviceName
                };
                this.workers[socketId] = worker;
                this.changeWorkerStatus(worker, READY);
            }
        }
    }, {
        key: 'removeWorker',
        value: function removeWorker(worker) {
            if (worker) {
                var socketId = worker.socketId,
                    services = this.services[worker.service],
                    servicePos = services.indexOf(toUInt32(socketId));
                if (servicePos >= 0) {
                    services.splice(servicePos, 1);
                }
                delete this.workers[toUInt32(socketId)];
            }
        }
    }, {
        key: 'cleanupWorkersAndRequests',
        value: function cleanupWorkersAndRequests() {
            var _this6 = this;

            var now = Date.now(),
                currentClient = void 0,
                currentWorker = void 0,
                workerTimeout = this.workerTimeout,
                clientTimeout = this.clientTimeout;
            Object.keys(this.requests).forEach(function (socketId) {
                currentClient = _this6.requests[socketId];
                if (now - currentClient.ts > clientTimeout) {
                    delete _this6.requests[socketId];
                }
            });
            Object.keys(this.workers).forEach(function (socketId) {
                currentWorker = _this6.workers[socketId];
                if (now - currentWorker.ts > workerTimeout) {
                    _this6._sendDisconnect(currentWorker);
                    _this6.removeWorker(currentWorker);
                    _this6.emit(events.EV_DISCONNECT, {
                        socketId: currentWorker.socket.boundTo,
                        service: currentWorker.service
                    });
                } else {
                    _this6._sendHeartBeat(currentWorker);
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
        services: {},
        sockets: []
    }, props);
    broker.hbFrequence = broker.hbFrequence || Math.trunc(broker.workerTimeout / 3);
    MDP02.addToProcessListener(function () {
        return broker.stop();
    });
    return broker;
}

module.exports = makeBroker;
module.exports.events = events;