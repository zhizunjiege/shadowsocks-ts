"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = require("path");
const socks_1 = require("./socks");
const logger_1 = require("./logger");
let config = require('../config.json');
global.console = new logger_1.default({
    level: config.log.level,
    timestamp: true,
    stdout: path_1.resolve(process.cwd(), config.log.stdout),
    stderr: path_1.resolve(process.cwd(), config.log.stderr)
});
const server = new socks_1.default({
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
