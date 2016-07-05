/* global require */
/* global process */
/* global setImmediate */

require('babel-polyfill');
const EventEmitter = require('events'),
    zmq = require('zmq'),
    MDP02 = require('./mdp02'),
    Writable = require('stream').Writable;

const events = {
    EV_MESSAGE: 'message',
    EV_REQ: 'request',
    EV_HB: 'heartbeat',
    EV_CLOSE_REQ: 'close-request'
};

let processExit = false;

class ZMQWritable extends Writable {
    constructor(zmqWorker, options) {
        super(options);
        this.zmqWorker = zmqWorker;
    }

    _chunkToBuffer(chunk, enc) {
        let buffer;
        if (chunk) {
            buffer = (Buffer.isBuffer(chunk)) ?
                chunk :
                Buffer.from(chunk, enc);
        } else {
            buffer = Buffer.alloc(0);
        }
        return buffer;
    }

    _write(chunk, enc, cb) {
        this.zmqWorker._sendMsg(this._chunkToBuffer(chunk, enc), true);
        cb();
    }

    _writev(chunks, cb) {
        chunks.forEach((chunk)=>{
            this.zmqWorker._sendMsg(this._chunkToBuffer(chunk, enc), true);
        });
        cb();
    }

    end(chunk, enc, cb) {
        this.zmqWorker._sendMsg(this._chunkToBuffer(chunk, enc));
        super.end(chunk, enc, cb);
    }
}

class Worker extends EventEmitter {
    emitErr(err) {
        setImmediate(() => this.emit('error', err));
    }

    start() {
        if (this.connected) {
            return false;
        } else {
            delete this._currentClient;
            this.socket.connect(this.address);
            this._sendReady();
            return true;
        }
    }

    stop(skipDisconnect) {
        if (this.connected) {
            this.stopHeartBeat();
            skipDisconnect || this._sendDisconnect();
            this.connected = false;
            delete this._currentClient;
            if (processExit) {
                this.socket.close();
            } else {
                this.socket.disconnect(address);
            }
        }
    }

    _isValid(rep) {
        if (!Array.isArray(rep) || rep.length < 2) {
            this.emitErr(new MDP02.E_PROTOCOL('Wrong frames number'));
            this.stop();
            return false;
        }

        var protocol = rep[0].toString();
        var messageType = rep[1].toString();

        if ((protocol !== MDP02.WORKER) || ![MDP02.W_REQUEST, MDP02.W_HEARTBEAT, MDP02.W_DISCONNECT].find((i) => i === messageType)) {
            this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
            return false;
        }

        if (messageType === MDP02.W_REQUEST && (rep.length < 5 || !rep[2].toString())) {
            this.emitErr(new MDP02.E_PROTOCOL(MDP02.dumpFrames(rep)));
            return false;
        }

        return true;
    }

    _onMsg(rep) {
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

                        this.emit(events.EV_REQ, {
                            response: new ZMQWritable(this),
                            request: rep.slice(4)
                        });
                    }
                    break;
            }
        }
    }

    _sendReady() {
        this.connected = true;
        this._send([
            MDP02.WORKER, MDP02.W_READY, this.serviceName
        ]);
        this.startHeartBeat();
    }

    _sendMsg(msg, partial) {
        let currClient = this._currentClient;
        this._send([
            MDP02.WORKER, partial ? MDP02.W_PARTIAL : MDP02.W_FINAL, currClient, '',
            msg
        ]);
        if (!partial) {
            delete this._currentClient;
        }
    }

    _sendHeartBeat() {
        this._send([
            MDP02.WORKER, MDP02.W_HEARTBEAT
        ]);
    }

    _sendDisconnect() {
        this.stopHeartBeat();
        this._send([
            MDP02.WORKER, MDP02.W_DISCONNECT
        ]);
    }

    startHeartBeat() {
        this.heartBeatTs = Date.now();
        this._hbTimer = setInterval(() => {
            if (Date.now() - this.heartBeatTs > this.workerTolerance) {
                this.stop(true);
                this.start();
            } else {
                this._sendHeartBeat();
            }
        }, this.hbFrequence);
    }

    stopHeartBeat() {
        clearInterval(this._hbTimer);
    }

    _send(msg) {
        this.socket.send(msg);
    }
}

function makeWorker(props) {
    let worker = new Worker(),
        socket = zmq.socket('dealer');
    Object.assign(worker, {
        timeout: MDP02.TIMEOUT,
        hbFrequence: MDP02.HB_FREQUENCE,
        socket: socket,
        address: props.address
    }, props);

    MDP02.addToProcessListener(() => {
        processExit = true;
        worker.stop();
    });

    socket.on('message', (...args) => {
        worker.emit(events.EV_MESSAGE, args);
        try {
            worker._onMsg(args);
        } catch (err) {
            worker.emitErr(err);
        }
    });

    socket.on('error', (err) => {
        worker.emitErr(err);
        worker.stop();
        worker.start();
    });


    return worker;
}

module.exports = makeWorker;
module.exports.events = events;
