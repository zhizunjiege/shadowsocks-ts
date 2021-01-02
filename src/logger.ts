import { Console } from 'console';
import { createWriteStream } from 'fs';

enum LogLevel {
    DEBUG = 0,
    INFO,
    WARN,
    ERROR
}

interface LogConfig {
    level?: 'debug' | 'info' | 'warn' | 'error';
    timestamp?: boolean,
    stdout?: string;
    stderr?: string;
}

export default class Logger extends Console {
    private level: LogLevel;
    private timestamp: boolean;

    constructor(config: LogConfig) {
        let {
            level = 'error',
            timestamp = true,
            stdout, stderr
        } = config;

        let _stdout: NodeJS.WritableStream = process.stdout;
        let _stderr: NodeJS.WritableStream = process.stderr;
        if (stdout) {
            _stdout = createWriteStream(stdout);
        }
        if (stderr) {
            _stderr = createWriteStream(stderr);
        }
        super(_stdout, _stderr);

        switch (level) {
            case 'debug': this.level = LogLevel.DEBUG; break;
            case 'info': this.level = LogLevel.INFO; break;
            case 'warn': this.level = LogLevel.WARN; break;
            default: this.level = LogLevel.ERROR; break;
        }
        this.timestamp = timestamp;
    }
    public log(level: LogLevel, msg: any[]) {
        if (level >= this.level) {
            if (level >= LogLevel.WARN) {
                super.error(this.timestamp ? `${new Date().toLocaleString()} : ` : ``, ...msg);
            } else {
                super.log(this.timestamp ? `${new Date().toLocaleString()} : ` : ``, ...msg);
            }
        }
    }
    public debug(...msg: any[]) {
        this.log(LogLevel.DEBUG, msg);
    }
    public info(...msg: any[]) {
        this.log(LogLevel.INFO, msg);
    }
    public warn(...msg: any[]) {
        this.log(LogLevel.WARN, msg);
    }
    public error(...msg: any[]) {
        this.log(LogLevel.ERROR, msg);
    }
}
