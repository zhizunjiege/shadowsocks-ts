"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const net = require("net");
const dgram = require("dgram");
const ip = require("ip");
var Version;
(function (Version) {
    Version[Version["SOCKS5"] = 5] = "SOCKS5";
})(Version || (Version = {}));
var Method;
(function (Method) {
    Method[Method["NOAUTH"] = 0] = "NOAUTH";
    Method[Method["GSSAPI"] = 1] = "GSSAPI";
    Method[Method["USERPASS"] = 2] = "USERPASS";
    Method[Method["NONE"] = 255] = "NONE";
})(Method || (Method = {}));
var Command;
(function (Command) {
    Command[Command["CONNECT"] = 1] = "CONNECT";
    Command[Command["BIND"] = 2] = "BIND";
    Command[Command["ASSOCIATE"] = 3] = "ASSOCIATE";
})(Command || (Command = {}));
var Response;
(function (Response) {
    Response[Response["SUCCESS"] = 0] = "SUCCESS";
    Response[Response["SERVER_ERR"] = 1] = "SERVER_ERR";
    Response[Response["SERVER_REJECT"] = 2] = "SERVER_REJECT";
    Response[Response["NET_ERR"] = 3] = "NET_ERR";
    Response[Response["REMOTE_INACCESSIBLE"] = 4] = "REMOTE_INACCESSIBLE";
    Response[Response["REMOTE_REJECT"] = 5] = "REMOTE_REJECT";
    Response[Response["TTL_EXPIRED"] = 6] = "TTL_EXPIRED";
    Response[Response["UNSUPPORTED_CMD"] = 7] = "UNSUPPORTED_CMD";
    Response[Response["UNSUPPORTED_ADDRTYPE"] = 8] = "UNSUPPORTED_ADDRTYPE";
    Response[Response["NONE"] = 255] = "NONE";
})(Response || (Response = {}));
var Addrtype;
(function (Addrtype) {
    Addrtype[Addrtype["IPV4"] = 1] = "IPV4";
    Addrtype[Addrtype["DOMAIN"] = 3] = "DOMAIN";
    Addrtype[Addrtype["IPV6"] = 4] = "IPV6";
})(Addrtype || (Addrtype = {}));
var Stage;
(function (Stage) {
    Stage[Stage["REQ"] = 0] = "REQ";
    Stage[Stage["AUTH"] = 1] = "AUTH";
    Stage[Stage["CMD"] = 2] = "CMD";
    Stage[Stage["READY"] = 3] = "READY";
    Stage[Stage["UDPRELAY"] = 4] = "UDPRELAY";
    Stage[Stage["DISCONNECTED"] = 5] = "DISCONNECTED";
})(Stage || (Stage = {}));
class LRUCache {
    constructor(config) {
        let { timeout = 1 * 60 * 1000, max = 100, beforeDeleteFn } = config;
        this.timeout = timeout;
        this.max = max;
        this.beforeDeleteFn = beforeDeleteFn;
        this.count = 0;
        this.cache = {};
    }
    setItem(key, value) {
        if (this.count >= this.max) {
            this.sweep();
        }
        this.cache[key] = [process.hrtime.bigint(), value];
        this.count++;
    }
    getItem(key) {
        let val = this.cache[key];
        if (val) {
            val[0] = process.hrtime.bigint();
            return val[1];
        }
        else {
            return null;
        }
    }
    delItem(key) {
        this.beforeDeleteFn?.(this.cache[key]?.[1]);
        this.count--;
        return delete this.cache[key];
    }
    destroy() {
        for (const k of Object.keys(this.cache)) {
            this.delItem(k);
        }
    }
    sweep() {
        for (const k of Object.keys(this.cache)) {
            if (process.hrtime.bigint() - this.cache[k][0] > this.timeout * 0.001) {
                this.delItem(k);
            }
        }
        if (this.count >= this.max) {
            let min = process.hrtime.bigint(), key = '';
            for (const k of Object.keys(this.cache)) {
                if (this.cache[k][0] <= min) {
                    min = this.cache[k][0];
                    key = k;
                }
            }
            this.delItem(key);
        }
    }
}
class Socks {
    constructor(config) {
        let { host = '127.0.0.1', port = 1080, timeout = 60 * 1000, maxConnections = 666, onauth } = config;
        this.connections = 0;
        this.onauth = onauth;
        this.timestamp = process.hrtime.bigint();
        this.netflowup = 0;
        this.netflowdown = 0;
        this.TCPServer = new net.Server();
        this.TCPServer.maxConnections = maxConnections;
        this.TCPServer.on('listening', () => {
            console.debug('Tcp server event "listening" has been emitted...');
            console.info(`Tcp sever is listening at ${host}:${port}...`);
        });
        this.TCPServer.on('connection', connection => {
            console.debug('Tcp server event "connection" has been emitted...');
            this.connections++;
            console.debug(`Tcp server has ${this.connections} connections.`);
            let stage = Stage.REQ;
            let connected = true;
            let remote = new net.Socket();
            let clean = () => {
                connected = false;
                connection.destroy();
                remote.destroy();
            };
            connection.setNoDelay(true);
            connection.setTimeout(timeout);
            connection.on('data', data => {
                console.debug('Client connection event "data" has been emitted...', data);
                if (!connected) {
                    return;
                }
                this.netflowup += data.length;
                switch (stage) {
                    case Stage.READY:
                        if (!remote.write(data)) {
                            connection.pause();
                        }
                        console.debug('Stage READY...');
                        break;
                    case Stage.UDPRELAY:
                        break;
                    case Stage.REQ:
                        let counts = data[1], methods = data.slice(2, 2 + counts);
                        if (methods.includes(Method.USERPASS)) {
                            connection.write(Buffer.from([Version.SOCKS5, Method.USERPASS]));
                            stage = Stage.AUTH;
                        }
                        else {
                            connection.write(Buffer.from([Version.SOCKS5, Method.NOAUTH]));
                            stage = Stage.CMD;
                        }
                        console.debug('Stage REQ...');
                        break;
                    case Stage.AUTH:
                        let version = data[0], userlen = data[1], username = data.slice(2, 2 + userlen), passlen = data[2 + userlen], password = data.slice(3 + userlen, 3 + userlen + passlen);
                        if (this.onauth?.(username, password)) {
                            connection.write(Buffer.from([version, 0x00]));
                            stage = Stage.CMD;
                        }
                        else {
                            connection.end(Buffer.from([version, 0xFF]));
                            stage = Stage.DISCONNECTED;
                        }
                        console.debug('Stage AUTH...');
                        break;
                    case Stage.CMD:
                        let cmd = data[1], addrtype = data[3];
                        switch (cmd) {
                            case Command.CONNECT:
                                let host = '', port = 0;
                                switch (addrtype) {
                                    case Addrtype.DOMAIN:
                                        let len = data[4];
                                        host = data.slice(5, 5 + len).toString();
                                        port = data.readUInt16BE(5 + len);
                                        break;
                                    case Addrtype.IPV4:
                                        host = ip.toString(data, 4, 4);
                                        port = data.readUInt16BE(8);
                                        break;
                                    case Addrtype.IPV6:
                                        host = ip.toString(data, 4, 16);
                                        port = data.readUInt16BE(20);
                                        break;
                                    default:
                                        connection.end(Buffer.from([Version.SOCKS5, Response.UNSUPPORTED_ADDRTYPE, 0x00, Addrtype.IPV4]));
                                        stage = Stage.DISCONNECTED;
                                        return;
                                }
                                let localPort = Buffer.alloc(2);
                                localPort.writeUInt16BE(connection.localPort);
                                connection.write(Buffer.concat([
                                    Buffer.from([Version.SOCKS5, Response.SUCCESS, 0x00, Addrtype.IPV4]),
                                    ip.toBuffer(connection.localAddress),
                                    localPort
                                ]));
                                console.debug('host:', host, 'port', port);
                                remote.connect(port, host);
                                stage = Stage.READY;
                                break;
                            case Command.ASSOCIATE:
                                let clientPort = Buffer.alloc(2);
                                clientPort.writeUInt16BE(connection.localPort);
                                connection.write(Buffer.concat([
                                    Buffer.from([Version.SOCKS5, Response.SUCCESS, 0x00, Addrtype.IPV4]),
                                    ip.toBuffer(connection.localAddress),
                                    clientPort
                                ]));
                                stage = Stage.UDPRELAY;
                                break;
                            case Command.BIND:
                            default:
                                connection.end(Buffer.from([Version.SOCKS5, Response.UNSUPPORTED_CMD, 0x00, Addrtype.IPV4]));
                                stage = Stage.DISCONNECTED;
                                return;
                        }
                        console.debug('Stage CMD...');
                        break;
                    default:
                        return;
                }
            });
            connection.on('drain', function () {
                console.debug('Client connection event "drain" has been emitted...');
                if (!connected) {
                    return;
                }
                remote.resume();
            });
            connection.on('timeout', function () {
                console.debug('Client connection event "timeout" has been emitted...');
                clean();
            });
            connection.on('end', function () {
                console.debug('Client connection event "end" has been emitted...');
                clean();
            });
            connection.on('error', function (err) {
                console.debug(`Client connection event "error" has been emitted...Error message is ${err.message}`);
                if (!(err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET'))) {
                    console.error('Client connection has an error : ', err);
                }
                clean();
            });
            connection.on('close', had_err => {
                console.debug('Client connection event "close" has been emitted...', 'And whether caused by error is ', had_err);
                this.connections--;
                clean();
            });
            remote.setNoDelay(true);
            remote.setTimeout(timeout);
            remote.on('data', data => {
                console.debug('Remote connection event "data" has been emitted...', data);
                if (!connected) {
                    return;
                }
                this.netflowdown += data.length;
                if (!connection.write(data)) {
                    remote.pause();
                }
            });
            remote.on('drain', function () {
                console.debug('Remote connection event "drain" has been emitted...');
                if (!connected) {
                    return;
                }
                connection.resume();
            });
            remote.on('timeout', function () {
                console.debug('Remote connection event "timeout" has been emitted...');
                clean();
            });
            remote.on('end', function () {
                console.debug('Remote connection event "end" has been emitted...');
                clean();
            });
            remote.on('error', function (err) {
                console.debug(`Remote connection event "error" has been emitted...Error message is ${err.message}`);
                if (!(err.message.includes('ETIMEDOUT') || err.message.includes('ECONNRESET'))) {
                    console.error('Remote connection has an error : ', err);
                }
                clean();
            });
            remote.on('close', function (had_err) {
                console.debug('Remote connection event "close" has been emitted...', 'And whether caused by error is ', had_err);
                clean();
            });
        });
        this.TCPServer.on('error', err => {
            console.debug('Tcp server event "error" has been emitted...');
            console.error('Tcp server has an error : ', err);
        });
        this.TCPServer.on('close', () => {
            console.debug('Tcp server event "close" has been emitted...');
            console.info('Tcp server is closing...');
            console.info(`Netflow upload : ${this.netflowup},download : ${this.netflowdown}.`);
        });
        this.TCPServer.listen(port, host);
        this.UDPServer = dgram.createSocket('udp4');
        let server = this.UDPServer;
        let UDPSocketCache = new LRUCache({
            max: maxConnections,
            beforeDeleteFn: socket => socket.close()
        });
        server.on('listening', () => {
            console.debug('Udp server event "listening" has been emitted...');
            console.info(`Udp server is listening at ${host}:${port}...`);
        });
        server.on('message', (data, rinfo) => {
            console.debug('Udp server event "message" has been emitted...', data, rinfo);
            this.netflowup += data.length;
            if (data[2] === 0) {
                let addrtype = data[3], host = '', port = 0, buf;
                switch (addrtype) {
                    case Addrtype.DOMAIN:
                        let len = data[4];
                        host = data.slice(5, 5 + len).toString();
                        port = data.readUInt16BE(5 + len);
                        buf = data.slice(7 + len);
                        break;
                    case Addrtype.IPV4:
                        host = ip.toString(data, 4, 4);
                        port = data.readUInt16BE(8);
                        buf = data.slice(10);
                        break;
                    case Addrtype.IPV6:
                        host = ip.toString(data, 4, 16);
                        port = data.readUInt16BE(20);
                        buf = data.slice(22);
                        break;
                    default:
                        return;
                }
                let key = `${rinfo.address}:${rinfo.port}:${host}:${port}`;
                let client = UDPSocketCache.getItem(key);
                if (client === null) {
                    client = dgram.createSocket(ip.isV4Format(host) ? 'udp4' : 'udp6');
                    client.on('message', (_data, _rinfo) => {
                        console.debug('Udp socket event "message" has been emitted...', _data, _rinfo);
                        this.netflowdown += data.length;
                        let remotePort = Buffer.alloc(2);
                        remotePort.writeUInt16BE(_rinfo.port);
                        server.send(Buffer.concat([
                            Buffer.from([0x00, 0x00, 0x00, _rinfo.family === 'IPv4' ? Addrtype.IPV4 : Addrtype.IPV6,]),
                            ip.toBuffer(_rinfo.address),
                            remotePort,
                            _data
                        ]), rinfo.port, rinfo.address);
                    });
                    client.on('error', err => {
                        console.debug('Udp socket event "error" has been emitted...');
                        console.error('Udp socket has an error : ', err);
                    });
                    client.on('close', () => {
                        console.debug('Udp socket event "close" has been emitted...');
                    });
                    UDPSocketCache.setItem(key, client);
                }
                client.send(buf, port, host);
            }
        });
        server.on('error', err => {
            console.debug('Udp server event "error" has been emitted...');
            console.error('Udp server has an error : ', err);
            UDPSocketCache.destroy();
        });
        server.on('close', () => {
            console.debug('Udp server event "close" has been emitted...');
            console.info('Udp server is closing...');
            console.info(`Netflow upload : ${this.netflowup},download : ${this.netflowdown}.`);
            UDPSocketCache.destroy();
        });
        server.bind(port, host);
    }
}
exports.default = Socks;
