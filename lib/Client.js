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
    MDP02 = require('./mdp02');

var events = {
    EV_ERR: 'error',
    // EV_ERR_TIMEOUT: 'timeoutError',  -----not used
    EV_TIMEOUT: 'timeout',
    EV_DATA: 'data',
    EV_END: 'end'
};

var Client = function (_EventEmitter) {
    _inherits(Client, _EventEmitter);

    function Client() {
        _classCallCheck(this, Client);

        return _possibleConstructorReturn(this, Object.getPrototypeOf(Client).apply(this, arguments));
    }

    _createClass(Client, [{
        key: 'createSocket',
        value: function createSocket() {
            var _this2 = this;

            if (this.socket) {
                this.socket.removeAllListeners();
                this.socket.close();
            }
            this.socket = zmq.socket('dealer');
            this.socket.on('message', function () {
                for (var _len = arguments.length, args = Array(_len), _key = 0; _key < _len; _key++) {
                    args[_key] = arguments[_key];
                }

                try {
                    _this2._onMsg(args);
                } catch (err) {
                    _this2.emitErr(err);
                }
            });

            this.socket.on('error', function (err) {
                return _this2.emitErr(err);
            });
            this.socket.connect(this.address);
        }
    }, {
        key: 'emitErr',
        value: function emitErr(err) {
            this.emit(events.EV_ERR, err);
            clearInterval(this.reqTimer);
            delete this.reqTimer;
            this.stop();
        }
    }, {
        key: '_intervalFunction',
        value: function _intervalFunction() {
            if (this._tries < this.maxRetries) {
                this.stop(true);
                this.start();
                this._sendMsg(this._currentMessage);
                this._tries++;
            } else {
                this.emitErr(new MDP02.E_TIMEOUT('Timeout'));
            }
        }
    }, {
        key: 'send',
        value: function send(service, msg) {
            var _this3 = this;

            this._service = service;
            if (this.reqTimer || !this._service) {
                return false;
            } else {
                clearInterval(this.reqTimer);
                delete this.reqTimer;
                this._service = service;
                this._currentMessage = msg;
                this._tries = 0;

                this.start();
                setImmediate(function () {
                    return _this3._sendMsg(msg);
                });
                this._sendMsg(msg);
                this.reqTimer = setInterval(function () {
                    return _this3._intervalFunction();
                }, this.timeout);

                return true;
            }
        }
    }, {
        key: 'start',
        value: function start() {
            if (!this.connected) {
                this.createSocket();
                this.connected = true;
            }
            return this;
        }
    }, {
        key: 'stop',
        value: function stop(keepInterval) {
            if (this.connected) {
                if (!keepInterval) {
                    clearInterval(this.reqTimer);
                    delete this.reqTimer;
                }
                this.socket.removeAllListeners();
                this.socket.close();
                this.connected = false;
                delete this.socket;
            }
            return this;
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

            if (protocol !== MDP02.CLIENT || ![MDP02.C_PARTIAL, MDP02.C_FINAL].find(messageType) || service !== this._service) {
                this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
                return false;
            }

            return true;
        }
    }, {
        key: '_onMsg',
        value: function _onMsg(rep) {
            var _this4 = this;

            if (this._isValid(rep)) {
                clearInterval(this.reqTimer);
                delete this.reqTimer;
                var messageType = rep[1].toString(),
                    responseData = rep.slice(3);

                this._tries = 0;
                if (messageType === MDP02.C_PARTIAL) {
                    this.reqTimer = setInterval(function () {
                        return _this4._intervalFunction();
                    }, this.timeout);
                } else {
                    //MDP02.C_FINAL
                    this._tries = 0;
                    this._currentMessage = null;
                }
                this.emit(events.EV_DATA, { messageType: messageType, data: responseData });
                if (messageType === MDP02.C_FINAL) {
                    this.emit(events.EV_END, { messageType: messageType, data: responseData });
                }
            }
        }
    }, {
        key: '_sendMsg',
        value: function _sendMsg(msg) {
            this.socket.send([MDP02.CLIENT, MDP02.C_REQUEST, this._service, msg]);
        }
    }]);

    return Client;
}(EventEmitter);

function makeClient(props) {
    var client = new Client();

    Object.assign(client, {
        timeout: MDP02.TIMEOUT
    }, props);

    ['SIGTERM', 'SIGINT', 'exit'].forEach(function (signal) {
        return process.on(signal, function () {
            return client.stop();
        });
    });
    return client;
}

module.exports = makeClient;
module.exports.events = events;
//# sourceMappingURL=Client.js.map
