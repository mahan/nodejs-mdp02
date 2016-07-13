/* global require */
/* global setImmediate */

require('babel-polyfill');
const EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02'),
    Readable = require('stream').Readable;

const events = {
    EV_ERR: 'error',
    EV_DATA: 'data',
    EV_END: 'end'
};

class ZMQReadable extends Readable {
    constructor(zmqClient, options) {
        super(options);
        this.zmqClient = zmqClient;
        zmqClient.on("data", (event) => {
            event.data.forEach((data) => {
                this.emit("data", data);
            });
        });
        zmqClient.on("end", () => {
            this.emit("end");
        });
        zmqClient.on("error", (err) => {
            this.emit("error", err);
        });
    }

    pause() {
        this.zmqClient.socket.pause();
    }

    isPaused() {
        return this.zmqClient.socket.isPaused();
    }

    resume() {
        this.zmqClient.socket.resume();
    }

    _read() {
        this.resume();
    }
}

class Client extends EventEmitter {
    createSocket() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
        }
        this.socket = zmq.socket('dealer');
        this.socket.pause();
        this.socket.on('message', (...args) => {

            try {
                this._onMsg(args);
            } catch (err) {
                this.emitErr(err);
            }
        });

        this.socket.on('error', (err) => this.emitErr(err));
        this.socket.connect(this.address);
    }

    emitErr(err) {
        this.emit(events.EV_ERR, err);
        this._stopReceiver();
        this.stop();
    }

    _intervalFunction() {
        if (this._tries < this.maxRetries) {
            this._disconnect()
            this._start();
            this._sendMsg();
            this._tries++;
        } else {
            this.emitErr(new MDP02.E_TIMEOUT('Timeout'));
        }
    }

    send(service, msg) {
        if (!service) {
            throw MDP02.E_PROTOCOL("sevice name is mandatory");
        }

        let stream = new ZMQReadable(this);

        this._processRequest({
            service,
            msg,
            stream
        });

        return stream;

    }

    _processRequest(request) {
        if (request) {
            this.requests.push(request);
        }
        if (!this.reqTimer) {
            let currRequest = this.requests.shift();
            if (currRequest) {
                this._service = currRequest.service;
                this._currentMessage = currRequest.msg;
                this._tries = 0;
                this._start();
                this.reqTimer = setInterval(() => this._intervalFunction(), this.timeout);
                setImmediate(() => this._sendMsg());
            }
        }
    }

    _start() {
        if (!this.connected) {
            this.createSocket();
            this.connected = true;
        }
        return this;
    }

    stop() {
        if (this.connected) {
            this._stopReceiver();
            this._disconnect();
        }
        return this;
    }

    _disconnect() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
            this.connected = false;
            delete this.socket;
        }
    }

    _isValid(rep) {
        if (!Array.isArray(rep) || rep.length < 4) {
            this.emitErr(new MDP02.E_PROTOCOL('Wrong frames number'));
            return false;
        }
        let protocol = rep[0].toString(),
            messageType = rep[1].toString(),
            service = rep[2].toString();

        if ((protocol !== MDP02.CLIENT) ||
            (MDP02.C_PARTIAL !== messageType && MDP02.C_FINAL !== messageType) ||
            (service !== this._service)) {
            this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
            return false;
        }

        return true;
    }

    _onMsg(rep) {
        if (this._isValid(rep)) {
            this._stopReceiver();
            let messageType = rep[1].toString(),
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
                setImmediate(() => this._processRequest());
            } else { //Partial
                this.reqTimer = setInterval(() => this._intervalFunction(), this.timeout);
            }
        }
    }

    _sendMsg() {
        this.socket.send([
            MDP02.CLIENT, MDP02.C_REQUEST, this._service,
            this._currentMessage
        ]);
    }

    _stopReceiver() {
        clearInterval(this.reqTimer);
        delete this.reqTimer;
        delete this._tries;
        delete this._currentMessage;
    }

}

Object.defineProperty(Client.prototype, 'status', {
    get: function () {
        return {
            tries: this._tries,
            currentMessage: this._currentMessage,
            currentService: this._service
        };
    }
})

function makeClient(props) {
    let client = new Client();

    Object.assign(client, {
        timeout: MDP02.TIMEOUT,
        requests: []
    }, props);

    MDP02.addToProcessListener(() => client.stop());
    return client;
}

module.exports = makeClient;
