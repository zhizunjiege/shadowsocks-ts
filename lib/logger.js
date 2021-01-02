"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const console_1 = require("console");
const fs_1 = require("fs");
var LogLevel;
(function (LogLevel) {
    LogLevel[LogLevel["DEBUG"] = 0] = "DEBUG";
    LogLevel[LogLevel["INFO"] = 1] = "INFO";
    LogLevel[LogLevel["WARN"] = 2] = "WARN";
    LogLevel[LogLevel["ERROR"] = 3] = "ERROR";
})(LogLevel || (LogLevel = {}));
class Logger extends console_1.Console {
    constructor(config) {
        let { level = 'error', timestamp = true, stdout, stderr } = config;
        let _stdout = process.stdout;
        let _stderr = process.stderr;
        if (stdout) {
            _stdout = fs_1.createWriteStream(stdout);
        }
        if (stderr) {
            _stderr = fs_1.createWriteStream(stderr);
        }
        super(_stdout, _stderr);
        switch (level) {
            case 'debug':
                this.level = LogLevel.DEBUG;
                break;
            case 'info':
                this.level = LogLevel.INFO;
                break;
            case 'warn':
                this.level = LogLevel.WARN;
                break;
            default:
                this.level = LogLevel.ERROR;
                break;
        }
        this.timestamp = timestamp;
    }
    log(level, msg) {
        if (level >= this.level) {
            if (level >= LogLevel.WARN) {
                super.error(this.timestamp ? `${new Date().toLocaleString()} : ` : ``, ...msg);
            }
            else {
                super.log(this.timestamp ? `${new Date().toLocaleString()} : ` : ``, ...msg);
            }
        }
    }
    debug(...msg) {
        this.log(LogLevel.DEBUG, msg);
    }
    info(...msg) {
        this.log(LogLevel.INFO, msg);
    }
    warn(...msg) {
        this.log(LogLevel.WARN, msg);
    }
    error(...msg) {
        this.log(LogLevel.ERROR, msg);
    }
}
exports.default = Logger;
