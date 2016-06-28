/* global require */
/* global setImmediate */

require('babel-polyfill');
const EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02');

const events = {
    EV_ERR: 'error',
    EV_TIMEOUT: 'timeout',
    EV_DATA: 'data',
    EV_END: 'end'
};

class Client extends EventEmitter {
    createSocket() {
        if (this.socket) {
            this.socket.removeAllListeners();
            this.socket.close();
        }
        this.socket = zmq.socket('dealer');
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
        clearInterval(this.reqTimer);
        delete this.reqTimer;
        this.stop();
    }

    _intervalFunction() {
        if (this._tries < this.maxRetries) {
            this.stop(true);
            this.start();
            this._sendMsg(this._currentMessage);
            this._tries++;
        } else {
            this.emitErr(new MDP02.E_TIMEOUT('Timeout'));
        }
    }

    send(service, msg) {
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
            setImmediate(() => this._sendMsg(msg));
            this.reqTimer = setInterval(() => this._intervalFunction(), this.timeout);

            return true;
        }
    }

    start() {
        if (!this.connected) {
            this.createSocket();
            this.connected = true;
        }
        return this;
    }

    stop(keepInterval) {
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
            clearInterval(this.reqTimer);
            delete this.reqTimer;
            let messageType = rep[1].toString(),
                service = rep[2].toString(),
                responseData = rep.slice(3);


            this._tries = 0;
            if (messageType === MDP02.C_PARTIAL) {
                this.reqTimer = setInterval(() => this._intervalFunction(), this.timeout);
            } else { //MDP02.C_FINAL
                this._tries = 0;
                this._currentMessage = null;
            }
            this.emit(events.EV_DATA, {
                service: service,
                messageType: messageType,
                data: responseData});
            if (messageType === MDP02.C_FINAL) {
                this.emit(events.EV_END, {
                    service: service,
                    messageType: messageType,
                    data: responseData});
            }
        }
    }

    _sendMsg(msg) {
        this.socket.send([
            MDP02.CLIENT, MDP02.C_REQUEST, this._service,
            msg
        ]);
    }

}

function makeClient(props) {
    let client = new Client();

    Object.assign(client, {
        timeout: MDP02.TIMEOUT
    }, props);

    MDP02.addToProcessListener(() => client.stop());
    return client;
}

module.exports = makeClient;
module.exports.events = events;


