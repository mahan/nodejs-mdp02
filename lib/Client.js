'use strict';

var _createClass = function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ("value" in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; }();

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError("Cannot call a class as a function"); } }

function _possibleConstructorReturn(self, call) { if (!self) { throw new ReferenceError("this hasn't been initialised - super() hasn't been called"); } return call && (typeof call === "object" || typeof call === "function") ? call : self; }

function _inherits(subClass, superClass) { if (typeof superClass !== "function" && superClass !== null) { throw new TypeError("Super expression must either be null or a function, not " + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

/* global require */
/* global setImmediate */

require('babel-polyfill');
var EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02'),
    Readable = require('stream').Readable;

var events = {
    EV_ERR: 'error',
    EV_DATA: 'data',
    EV_END: 'end'
};

var ZMQReadable = function (_Readable) {
    _inherits(ZMQReadable, _Readable);

    function ZMQReadable(zmqClient, options) {
        _classCallCheck(this, ZMQReadable);

        var _this = _possibleConstructorReturn(this, Object.getPrototypeOf(ZMQReadable).call(this, options));

        _this.zmqClient = zmqClient;
        zmqClient.on("data", function (event) {
            event.data.forEach(function (data) {
                _this.emit("data", data);
            });
        });
        zmqClient.on("end", function () {
            _this.emit("end");
        });
        zmqClient.on("error", function (err) {
            _this.emit("error", err);
        });
        return _this;
    }

    _createClass(ZMQReadable, [{
        key: 'pause',
        value: function pause() {
            this.zmqClient.socket.pause();
        }
    }, {
        key: 'isPaused',
        value: function isPaused() {
            return this.zmqClient.socket.isPaused();
        }
    }, {
        key: 'resume',
        value: function resume() {
            this.zmqClient.socket.resume();
        }
    }, {
        key: '_read',
        value: function _read() {
            this.resume();
        }
    }]);

    return ZMQReadable;
}(Readable);

var Client = function (_EventEmitter) {
    _inherits(Client, _EventEmitter);

    function Client() {
        _classCallCheck(this, Client);

        return _possibleConstructorReturn(this, Object.getPrototypeOf(Client).apply(this, arguments));
    }

    _createClass(Client, [{
        key: 'createSocket',
        value: function createSocket() {
            var _this3 = this;

            if (this.socket) {
                this.socket.removeAllListeners();
                this.socket.close();
            }
            this.socket = zmq.socket('dealer');
            this.socket.pause();
            this.socket.on('message', function () {
                for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments[_key];
                }

                try {
                    _this3._onMsg(args);
                } catch (err) {
                    _this3.emitErr(err);
                }
            });

            this.socket.on('error', function (err) {
                return _this3.emitErr(err);
            });
            this.socket.connect(this.address);
        }
    }, {
        key: 'emitErr',
        value: function emitErr(err) {
            this.emit(events.EV_ERR, err);
            this._stopReceiver();
            this.stop();
        }
    }, {
        key: '_intervalFunction',
        value: function _intervalFunction() {
            if (this._tries < this.maxRetries) {
                this._disconnect();
                this._start();
                this._sendMsg();
                this._tries++;
            } else {
                this.emitErr(new MDP02.E_TIMEOUT('Timeout'));
            }
        }
    }, {
        key: 'send',
        value: function send(service, msg) {
            if (!service) {
                throw MDP02.E_PROTOCOL("sevice name is mandatory");
            }

            var stream = new ZMQReadable(this);

            this._processRequest({
                service: service,
                msg: msg,
                stream: stream
            });

            return stream;
        }
    }, {
        key: '_processRequest',
        value: function _processRequest(request) {
            var _this4 = this;

            if (request) {
                this.requests.push(request);
            }
            if (!this.reqTimer) {
                var currRequest = this.requests.shift();
                if (currRequest) {
                    this._service = currRequest.service;
                    this._currentMessage = currRequest.msg;
                    this._tries = 0;
                    this._start();
                    this.reqTimer = setInterval(function () {
                        return _this4._intervalFunction();
                    }, this.timeout);
                    setImmediate(function () {
                        return _this4._sendMsg();
                    });
                }
            }
        }
    }, {
        key: '_start',
        value: function _start() {
            if (!this.connected) {
                this.createSocket();
                this.connected = true;
            }
            return this;
        }
    }, {
        key: 'stop',
        value: function stop() {
            if (this.connected) {
                this._stopReceiver();
                this._disconnect();
            }
            return this;
        }
    }, {
        key: '_disconnect',
        value: function _disconnect() {
            if (this.socket) {
                this.socket.removeAllListeners();
                this.socket.close();
                this.connected = false;
                delete this.socket;
            }
        }
    }, {
        key: '_isValid',
        value: function _isValid(rep) {
            if (!Array.isArray(rep) || rep.length < 4) {
                this.emitErr(new MDP02.E_PROTOCOL('Wrong frames number'));
                return false;
            }
            var protocol = rep[0].toString(),
                messageType = rep[1].toString(),
                service = rep[2].toString();

            if (protocol !== MDP02.CLIENT || MDP02.C_PARTIAL !== messageType && MDP02.C_FINAL !== messageType || service !== this._service) {
                this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
                return false;
            }

            return true;
        }
    }, {
        key: '_onMsg',
        value: function _onMsg(rep) {
            var _this5 = this;

            if (this._isValid(rep)) {
                this._stopReceiver();
                var messageType = rep[1].toString(),
                    service = rep[2].toString(),
                    responseData = rep.slice(3);

                this._tries = 0;

                this.emit(events.EV_DATA, {
                    service: service,
                    messageType: messageType,
                    data: responseData
                });

                if (messageType === MDP02.C_FINAL) {
                    this._stopReceiver();
                    this.emit(events.EV_END);
                    setImmediate(function () {
                        return _this5._processRequest();
                    });
                } else {
                    //Partial
                    this.reqTimer = setInterval(function () {
                        return _this5._intervalFunction();
                    }, this.timeout);
                }
            }
        }
    }, {
        key: '_sendMsg',
        value: function _sendMsg() {
            this.socket.send([MDP02.CLIENT, MDP02.C_REQUEST, this._service, this._currentMessage]);
        }
    }, {
        key: '_stopReceiver',
        value: function _stopReceiver() {
            clearInterval(this.reqTimer);
            delete this.reqTimer;
            delete this._tries;
            delete this._currentMessage;
        }
    }]);

    return Client;
}(EventEmitter);

Object.defineProperty(Client.prototype, 'status', {
    get: function get() {
        return {
            tries: this._tries,
            currentMessage: this._currentMessage,
            currentService: this._service
        };
    }
});

function makeClient(props) {
    var client = new Client();

    Object.assign(client, {
        timeout: MDP02.TIMEOUT,
        requests: []
    }, props);

    MDP02.addToProcessListener(function () {
        return client.stop();
    });
    return client;
}

module.exports = makeClient;