'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/* global require */
/* global process */
/* global setImmediate */

require('babel-polyfill');
var EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02');

var events = {
    EV_MESSAGE: 'message',
    EV_REQ: 'request',
    EV_HB: 'heartbeat',
    EV_CLOSE_REQ: 'close-request'
};

var Worker = function (_EventEmitter) {
    _inherits(Worker, _EventEmitter);

    function Worker() {
        _classCallCheck(this, Worker);

        return _possibleConstructorReturn(this, Object.getPrototypeOf(Worker).apply(this, arguments));
    }

    _createClass(Worker, [{
        key: 'emitErr',
        value: function emitErr(err) {
            setImmediate(function () {
                return self.emit('error', err);
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
            if (this.connected) {
                return false;
            } else {
                delete this._currentClient;
                return true;
            }
        }
    }, {
        key: 'stop',
        value: function stop(skipDisconnect) {
            if (this.connected) {
                this.stopHeartBeat();
                skipDisconnect || this._sendDisconnect();
                this.connected = false;
                delete this._currentClient;
            }
        }
    }, {
        key: '_isValid',
        value: function _isValid(rep) {
            if (!Array.isArray(rep) || rep.length < 2) {
                this.emitErr(new MDP02.E_PROTOCOL('Wrong frames number'));
                this.stop();
                return false;
            }

            var protocol = rep[0].toString();
            var messageType = rep[1].toString();

            if (protocol !== MDP02.WORKER || ![MDP02.W_REQUEST, MDP02.W_HEARTBEAT, MDP02.W_DISCONNECT].find(function (i) {
                return i === messageType;
            })) {
                this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
                return false;
            }

            if (messageType === MDP02.W_REQUEST && (rep.length < 5 || !rep[2].toString())) {
                this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
                return false;
            }

            return true;
        }
    }, {
        key: '_onMsg',
        value: function _onMsg(rep) {

            if (this._isValid(rep)) {
                var messageType = rep[1].toString();
                switch (messageType) {
                    case MDP02.W_HEARTBEAT:
                        this.emit(events.EV_HB, {});
                        this.heartBeatTs = Date.now();
                        break;
                    case MDP02.W_DISCONNECT:
                        this.emit(events.EV_CLOSE_REQ, null);
                        this.stop(true);
                        this.start();
                        break;
                    case MDP02.W_REQUEST:
                        if (this._currentClient) {
                            //situation is dirty: reconnect
                            this.stop();
                            this.start();
                        } else {
                            this._currentClient = rep[2];
                            this.emit(events.EV_REQ, rep.slice(4));
                        }
                        break;
                }
            }
        }
    }, {
        key: '_sendReady',
        value: function _sendReady() {
            this.connected = true;
            this._send([MDP02.WORKER, MDP02.W_READY, this.serviceName]);
            this.startHeartBeat();
        }
    }, {
        key: '_sendMsg',
        value: function _sendMsg(msg, partial) {
            var currClient = this._currentClient;
            this._send([MDP02.WORKER, partial ? MDP02.W_PARTIAL : MDP02.W_FINAL, currClient, '', msg]);
            if (!partial) {
                delete this._currentClient;
            }
        }
    }, {
        key: '_sendHeartBeat',
        value: function _sendHeartBeat() {
            this._send([MDP02.WORKER, MDP02.W_HEARTBEAT]);
        }
    }, {
        key: '_sendDisconnect',
        value: function _sendDisconnect() {
            this.stopHeartBeat();
            this._send([MDP02.WORKER, MDP02.W_DISCONNECT]);
        }
    }, {
        key: '_send',
        value: function _send() {
            throw new Error('Abstract method calling: _send');
        }
    }, {
        key: 'startHeartBeat',
        value: function startHeartBeat() {
            var _this2 = this;

            this.heartBeatTs = Date.now();
            this._hbTimer = setInterval(function () {
                if (Date.now() - _this2.heartBeatTs > _this2.workerTolerance) {
                    _this2.stop(true);
                    _this2.start();
                } else {
                    _this2._sendHeartBeat();
                }
            }, this.hbFrequence);
        }
    }, {
        key: 'stopHeartBeat',
        value: function stopHeartBeat() {
            clearInterval(this._hbTimer);
        }
    }]);

    return Worker;
}(EventEmitter);

function makeWorker(props) {
    var worker = new Worker(),
        address = props.address,
        processExit = false,
        socket = zmq.socket('dealer');
    Object.assign(worker, {
        timeout: MDP02.TIMEOUT,
        hbFrequence: MDP02.HB_FREQUENCE
    }, props);

    worker._send = socket.send;
    var start = worker.start,
        stop = worker.stop;

    worker.start = function () {
        "use strict";

        if (start.call(worker)) {
            socket.connect(address);
            worker._sendReady();
        }
    };

    // stop(skipDisconnect) {
    worker.stop = function (skipDisconnect) {
        "use strict";

        if (processExit) {
            socket.close();
        } else {
            socket.disconnect(address);
        }
        stop.call(worker, [skipDisconnect]);
    };

    ['SIGTERM', 'SIGINT', 'exit'].forEach(function (signal) {
        process.on(signal, function () {
            processExit = true;
            worker.stop();
        });
    });

    socket.on('message', function () {
        for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
            args[_key] = arguments[_key];
        }

        worker.emit(events.EV_MESSAGE, args);
        try {
            worker._onMsg(args);
        } catch (err) {
            worker.emitErr(err);
        }
    });

    socket.on('error', function (err) {
        worker.emitErr(err);
        worker.stop();
        worker.start();
    });

    return worker;
}

module.exports = makeWorker;
module.exports.events = events;
//# sourceMappingURL=Worker.js.map
