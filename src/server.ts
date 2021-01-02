import { resolve } from 'path';
import Socks from './socks';
import Logger from './logger';

let config = require('../config.json');

global.console = new Logger({
    level: config.log.level,
    timestamp: config.log.timestamp,
    stdout: config.log.stdout && resolve(process.cwd(), config.log.stdout),
    stderr: config.log.stderr && resolve(process.cwd(), config.log.stderr)
});

const server = new Socks({
    host: config.host,
    port: config.port,
    timeout: config.timeout,
    maxConnections: config.maxConnections,

    auth: config.auth,
    onauth: (username, password) => {
        let user = username.toString(), pass = password.toString();
        return config.user[user] === pass;
    }
});