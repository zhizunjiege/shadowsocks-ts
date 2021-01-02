import { resolve } from 'path';
import Socks from './socks';
import Logger from './logger';

let config = require('../config.json');

global.console = new Logger({
    level: config.log.level,
    timestamp: true,
    stdout: resolve(process.cwd(), config.log.stdout),
    stderr: resolve(process.cwd(), config.log.stderr)
});

const server = new Socks({
    host: config.host,
    port: config.port,
    timeout: config.timeout,
    maxConnections: config.maxConnections,

    onauth: (username, password) => {
        let user = username.toString(), pass = password.toString();
        console.debug('user:', user, 'pass:', pass);
        return config.user[user] === pass;
    }
});