import * as net from 'net';
import * as dgram from 'dgram';
import * as ip from 'ip';

enum Version {
    SOCKS5 = 0x05
}
enum Method {
    NOAUTH = 0x00,
    GSSAPI = 0x01,
    USERPASS = 0x02,
    NONE = 0xFF
}
enum Command {
    CONNECT = 0x01,
    BIND = 0x02,
    ASSOCIATE = 0x03
}
enum Response {
    SUCCESS = 0x00,
    SERVER_ERR,
    SERVER_REJECT,
    NET_ERR,
    REMOTE_INACCESSIBLE,
    REMOTE_REJECT,
    TTL_EXPIRED,
    UNSUPPORTED_CMD,
    UNSUPPORTED_ADDRTYPE,
    NONE = 0xFF
}
enum Addrtype {
    IPV4 = 0x01,
    DOMAIN = 0x03,
    IPV6 = 0x04
}
enum Stage {
    REQ,
    AUTH,
    CMD,
    READY,
    UDPRELAY,
    DISCONNECTED
}

interface LRUCacheConfig<T> {
    timeout?: number;
    interval?: number;
    max?: number;
    beforeDeleteFn?: (val: T) => void;
}

class LRUCache<T> {
    private timeout: number;
    // private interval: NodeJS.Timeout;
    private readonly max: number;
    private count: number;
    private cache: { [key: string]: [bigint, T] };

    private beforeDeleteFn: LRUCacheConfig<T>['beforeDeleteFn']

    // public get length() {
    //     return this.count;
    // };

    constructor(config: LRUCacheConfig<T>) {
        let {
            timeout = 1 * 60 * 1000,
            // interval = 60 * 1000,
            max = 100,
            beforeDeleteFn
        } = config;

        this.timeout = timeout;
        this.max = max;
        this.beforeDeleteFn = beforeDeleteFn;
        this.count = 0;
        this.cache = {};
        // this.interval = setInterval(this.sweep.bind(this), interval);
    }

    public setItem(key: string, value: T) {
        if (this.count >= this.max) {
            this.sweep();
        }
        this.cache[key] = [process.hrtime.bigint(), value];
        this.count++;
    }

    public getItem(key: string) {
        let val = this.cache[key];
        if (val) {
            val[0] = process.hrtime.bigint();
            return val[1];
        } else {
            return null;
        }
    }

    public delItem(key: string) {
        this.beforeDeleteFn?.(this.cache[key]?.[1]);
        this.count--;
        return delete this.cache[key];
    }

    public destroy() {
        // clearInterval(this.interval);
        for (const k of Object.keys(this.cache)) {
            this.delItem(k);
        }
    }

    private sweep() {
        for (const k of Object.keys(this.cache)) {
            if (process.hrtime.bigint() - this.cache[k][0] > this.timeout * 1000000) {
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

interface SocksConfig {
    host?: string;
    port?: number;
    timeout?: number;
    maxConnections?: number;

    auth?: boolean;
    onauth?: (username: Buffer, password: Buffer) => boolean;
}

class Socks {
    private TCPServer: net.Server;
    private connections: number;

    private UDPServer: dgram.Socket;

    private auth: boolean;
    private onauth: SocksConfig['onauth'];

    private timestamp: bigint;
    private netflowup: number;
    private netflowdown: number;

    constructor(config: SocksConfig) {
        let {
            host = '127.0.0.1',
            port = 1080,
            timeout = 60 * 1000,
            maxConnections = 100,
            auth = false,
            onauth
        } = config;

        this.connections = 0;

        this.auth = auth;
        this.onauth = onauth;

        this.timestamp = process.hrtime.bigint();
        this.netflowup = 0;
        this.netflowdown = 0;

        // Tcp Connect
        this.TCPServer = new net.Server();
        this.TCPServer.maxConnections = maxConnections;

        this.TCPServer.on('listening', () => {
            console.debug(`Tcp server event "listening" has been emitted...`);
            console.info(`Tcp sever is listening at ${host}:${port}...`);
        });
        this.TCPServer.on('connection', connection => {
            console.debug(`Tcp server event "connection" has been emitted...`);
            console.debug(`Client connection from ${connection.remoteAddress}:${connection.remotePort}`);

            this.connections++;

            console.debug(`Tcp server has ${this.connections} connections`);
            console.debug(`Process Memory Usage : ${process.memoryUsage()}`);

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
                console.debug(`Client connection event "data" has been emitted...`);
                console.debug(`Data is ${data}`);
                if (!connected) {
                    return;
                }
                this.netflowup += data.length;
                switch (stage) {
                    case Stage.READY:
                        console.debug('Stage READY...');
                        if (!remote.write(data)) {
                            connection.pause();
                        }
                        break;
                    case Stage.UDPRELAY:
                        console.debug('Stage UDPRELAY...');
                        break;
                    case Stage.REQ:
                        console.debug('Stage REQ...');
                        if (data[0] !== Version.SOCKS5 || data.length !== data[1] + 2) {
                            connection.end();
                            stage = Stage.DISCONNECTED;
                            return;
                        }
                        let counts = data[1], methods = data.slice(2, 2 + counts);
                        if (this.auth) {
                            if (methods.includes(Method.USERPASS)) {
                                connection.write(Buffer.from([Version.SOCKS5, Method.USERPASS]));
                                stage = Stage.AUTH;
                            } else {
                                connection.end(Buffer.from([Version.SOCKS5, Method.NONE]));
                                stage = Stage.DISCONNECTED;
                                return;
                            }
                        } else {
                            connection.write(Buffer.from([Version.SOCKS5, Method.NOAUTH]));
                            stage = Stage.CMD;
                        }
                        break;
                    case Stage.AUTH:
                        console.debug('Stage AUTH...');
                        let version = data[0],
                            userlen = data[1], username = data.slice(2, 2 + userlen),
                            passlen = data[2 + userlen], password = data.slice(3 + userlen, 3 + userlen + passlen);
                        console.debug(`Username : ${username} , Password : ${password}`);
                        if (this.onauth?.(username, password)) {
                            connection.write(Buffer.from([version, 0x00]));
                            stage = Stage.CMD;
                        } else {
                            connection.end(Buffer.from([version, 0xFF]));
                            stage = Stage.DISCONNECTED;
                        }
                        break;
                    case Stage.CMD:
                        console.debug('Stage CMD...');
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

                                console.debug(`Command CONNECT to ${host}:${port}...`);

                                remote.connect(port, host);
                                stage = Stage.READY;
                                break;
                            case Command.ASSOCIATE:
                                console.debug(`Command ASSOCIATE...`);
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
                            // TODO : Bind Command
                            default:
                                connection.end(Buffer.from([Version.SOCKS5, Response.UNSUPPORTED_CMD, 0x00, Addrtype.IPV4]));
                                stage = Stage.DISCONNECTED;
                                return;
                        }
                        break;
                    default:
                        console.debug('Stage DISCONNECTED...');
                        return;
                }
            });
            connection.on('drain', function () {
                console.debug(`Client connection event "drain" has been emitted...`);
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
                console.debug(`Client connection event "error" has been emitted..`);
                console.debug(`CLient connection has an error : ${err.message}`);
                clean();
            });
            connection.on('close', had_err => {
                console.debug(`Client connection event "close" has been emitted...It is ${had_err ? '' : 'not '}caused by error`);
                this.connections--;
                clean();
            });

            remote.setNoDelay(true);
            remote.setTimeout(timeout);
            remote.on('data', data => {
                console.debug(`Remote connection event "data" has been emitted...Data is ${data}`);
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
                console.debug(`Remote connection event "timeout" has been emitted...`);
                clean();
            });
            remote.on('end', function () {
                console.debug(`Remote connection event "end" has been emitted...`);
                clean();
            });
            remote.on('error', function (err) {
                console.debug(`Remote connection event "error" has been emitted...`);
                console.debug(`Remote connection has an error : ${err.message}`);
                clean();
            });
            remote.on('close', function (had_err) {
                console.debug(`Remote connection event "close" has been emitted...It is ${had_err ? '' : 'not '}caused by error`);
                clean();
            });
        });
        this.TCPServer.on('error', err => {
            console.debug(`Tcp server event "error" has been emitted...`);
            console.error(`Tcp server has an error : ${err.message}`);
        });
        this.TCPServer.on('close', () => {
            console.debug(`Tcp server event "close" has been emitted...`);
            console.info(`Tcp server is closing...`);
            console.info(`Netflow upload : ${this.netflowup} , download : ${this.netflowdown}`);
        });

        this.TCPServer.listen(port, host);

        // UDP Relay
        this.UDPServer = dgram.createSocket('udp4');

        let server = this.UDPServer;
        let UDPSocketCache = new LRUCache<dgram.Socket>({
            timeout: timeout,
            max: maxConnections,
            beforeDeleteFn: socket => socket.close()
        });

        server.on('listening', () => {
            console.debug(`Udp server event "listening" has been emitted...`);
            console.info(`Udp server is listening at ${host}:${port}...`);
        });
        server.on('message', (data, rinfo) => {
            console.debug(`Udp server event "message" has been emitted...`, data, rinfo);

            this.netflowup += data.length;

            if (data[2] === 0) {
                let addrtype = data[3], host = '', port = 0, buf: Buffer;
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
                        console.debug(`Udp socket event "message" has been emitted...`, _data, _rinfo);

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
                        console.debug(`Udp socket event "error" has been emitted...`);
                        console.debug(`Udp socket has an error : ${err.message}`);
                    });
                    client.on('close', () => {
                        console.debug(`Udp socket event "close" has been emitted...`);
                    });
                    UDPSocketCache.setItem(key, client);
                }
                client.send(buf, port, host);
            }
        });
        server.on('error', err => {
            console.debug(`Udp server event "error" has been emitted...`);
            console.error(`Udp server has an error : ${err.message}`);
            UDPSocketCache.destroy();
        });
        server.on('close', () => {
            console.debug(`Udp server event "close" has been emitted...`);
            console.info(`Udp server is closing...`);
            console.info(`Netflow upload : ${this.netflowup},download : ${this.netflowdown}`);
            UDPSocketCache.destroy();
        });

        server.bind(port, host);
    }
}

export default Socks;