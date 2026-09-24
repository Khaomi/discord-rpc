import { CUSTOM_RPC_ERROR_CODE, Transport, type TransportOptions } from "../structures/Transport";
import { RPCError } from "../utils/RPCError";
import crypto from "node:crypto";
import path from "node:path";
import net from "node:net";
import fs from "node:fs";

export enum IPC_OPCODE {
    HANDSHAKE,
    FRAME,
    CLOSE,
    PING,
    PONG
}

export type FormatFunction = (id: number) => string | [number, string];
export type PathData = { platform: NodeJS.Platform[]; format: FormatFunction };

export type IPCTransportOptions = {
    pathList?: PathData[];
} & TransportOptions;

const getTempDir = () => {
    const { XDG_RUNTIME_DIR, TMPDIR, TMP, TEMP } = process.env;
    return fs.realpathSync(XDG_RUNTIME_DIR ?? TMPDIR ?? TMP ?? TEMP ?? `${path.sep}tmp`);
};

const defaultPathList: PathData[] = [
    {
        platform: ["win32"],
        format: (id: number): string => `\\\\?\\pipe\\discord-ipc-${id}`
    },
    {
        platform: ["darwin", "linux", "freebsd", "openbsd", "netbsd"],
        format: (id: number): string => {
            // macOS / Linux / FreeBSD / OpenBSD / NetBSD path
            return path.join(getTempDir(), `discord-ipc-${id}`);
        }
    },
    {
        platform: ["linux"],
        format: (id: number): string => {
            // snap
            return path.join(getTempDir(), "snap.discord", `discord-ipc-${id}`);
        }
    },
    // flatpaks
    ...['com.discordapp.Discord', 'com.discordapp.DiscordCanary', 'com.discordapp.DiscordPTB', 'dev.vencord.Vesktop'].map((app) => ({
        platform: ["linux"],
        format: (id: number): string => {
            return path.join(getTempDir(), "app", app, `discord-ipc-${id}`);
        }
    } satisfies PathData)),
    {
        platform: [],
        format: (id: number): string => {
            // Super fallback, if thing don't work, well let just use this
            return path.join(getTempDir(), `discord-ipc-${id}`);
        }
    }
];

const createSocket = async (path: string | [number, string]): Promise<net.Socket> => {
    return new Promise((resolve, reject) => {
        const onError = () => {
            socket.removeListener("connect", onConnect);
            reject();
        };

        const onConnect = () => {
            socket.removeListener("error", onError);
            resolve(socket);
        };
        let socket: net.Socket;
        if (typeof path === "string") socket = net.createConnection(path);
        else socket = net.createConnection(path[0], path[1]);

        socket.once("connect", onConnect);
        socket.once("error", onError);
    });
};

export class IPCTransport extends Transport {
    public pathList: PathData[];
    private socket?: net.Socket;
    private workingBuffer: Buffer = Buffer.alloc(0);

    private heartbeatUUID?: string;
    private heartbeatTimer?: NodeJS.Timeout;
    private timeoutTimer?: NodeJS.Timeout;

    public override get isOpen() {
        return this.socket !== undefined && this.socket.readyState === "open";
    }

    constructor(options: IPCTransportOptions) {
        super(options);
        this.pathList = options.pathList ?? defaultPathList;
    }

    private async getSocket(): Promise<net.Socket> {
        if (this.socket) return this.socket;

        const pathList = this.pathList ?? defaultPathList;
        const pipeId = this.client.pipeId;

        return new Promise(async (resolve, reject) => {
            const useablePath: (string | [number, string])[] = [];

            for (const pat of pathList) {
                if (pat.platform.length <= 0 || !pat.platform.includes(process.platform)) continue;

                let pipeIdList = [];

                if (pipeId) pipeIdList = [pipeId];
                else for (let i = 0; i < 10; i++) pipeIdList.push(i);

                const maybeTcp = pat.format(0);
                if (Array.isArray(maybeTcp)) {
                    useablePath.push(maybeTcp);
                } else {
                    for (const pipeId of pipeIdList) {
                        const socketPath = pat.format(pipeId);
                        if (
                            process.platform !== "win32" &&
                            typeof socketPath === "string" &&
                            !fs.existsSync(socketPath)
                        )
                            continue;
                        useablePath.push(socketPath);
                    }
                }
            }

            this.client.emit(
                "debug",
                `CLIENT | Found ${useablePath.length} Discord client path;\n${useablePath.map((x) => (Array.isArray(x) ? `${x[1]}:${x[0]}` : x)).join("\n")}`
            );

            if (useablePath.length === 0)
                return reject(
                    new RPCError(CUSTOM_RPC_ERROR_CODE.COULD_NOT_FIND_CLIENT, "Unable to find any Discord client")
                );

            for (const path of useablePath) {
                const socket = await createSocket(path).catch(() => undefined);
                if (socket) return resolve(socket);
            }

            return reject(new RPCError(CUSTOM_RPC_ERROR_CODE.COULD_NOT_CONNECT, "Could not connect to Discord client"));
        });
    }

    public async connect(): Promise<void> {
        if (!this.socket) this.socket = await this.getSocket();
        if (this.isConnected) return;
        this.isConnected = true;

        this.emit("open");

        this.send(
            {
                v: 1,
                client_id: this.client.clientId
            },
            IPC_OPCODE.HANDSHAKE
        );

        const onConnectionStale = () => {
            this.isConnected = false;
            this.client.emit("debug", "CLIENT | Heartbeat not recieved, closing stale connection");
            this.close("Stale connection", true);
        };

        this.heartbeatTimer = setInterval(() => {
            this.heartbeatUUID = this.ping();
        }, this.heartbeatInterval);
        this.timeoutTimer = setTimeout(onConnectionStale, this.timeoutDuration);

        this.socket.on("readable", () => {
            let chunk: Buffer | null;

            while ((chunk = this.socket?.read() as Buffer | null) !== null) {
                this.client.emit("debug", `SERVER => CLIENT | READ ${chunk.length} BYTES`);
                this.workingBuffer = Buffer.concat([this.workingBuffer, chunk]);
            }

            while (this.workingBuffer.length >= 8) {
                const op = this.workingBuffer.readUInt32LE(0);
                const length = this.workingBuffer.readUInt32LE(4);

                if (this.workingBuffer.length < length + 8) break;

                const packetData = this.workingBuffer.subarray(8, length + 8);
                this.workingBuffer = this.workingBuffer.subarray(length + 8);

                let parsedData: any;
                try {
                    parsedData = JSON.parse(packetData.toString());
                } catch {
                    this.client.emit("debug", "SERVER => CLIENT | Malformed packet, invalid JSON payload");
                    continue;
                }

                this.client.emit("debug", `SERVER => CLIENT | OPCODE.${IPC_OPCODE[op]} |`, parsedData);

                switch (op) {
                    case IPC_OPCODE.FRAME: {
                        this.emit("message", parsedData);
                        break;
                    }
                    case IPC_OPCODE.CLOSE: {
                        this.emit("close", parsedData);
                        break;
                    }
                    case IPC_OPCODE.PONG: {
                        if (this.heartbeatUUID === parsedData) {
                            this.client.emit("debug", "CLIENT | Heartbeat recieved");
                            clearTimeout(this.timeoutTimer);
                            this.timeoutTimer = setTimeout(onConnectionStale, this.timeoutDuration);
                        }
                        break;
                    }
                    case IPC_OPCODE.PING: {
                        this.send(parsedData, IPC_OPCODE.PONG);
                        this.emit("ping");
                        break;
                    }
                }
            }
        });

        this.socket.on("close", () => {
            this.close("Closed by Discord", true);
        });
    }

    public send(message?: any, op: IPC_OPCODE | number = IPC_OPCODE.FRAME): void {
        this.client.emit("debug", `CLIENT => SERVER | OPCODE.${IPC_OPCODE[op]} |`, message);

        const dataBuffer = message ? Buffer.from(JSON.stringify(message)) : Buffer.alloc(0);

        const packet = Buffer.alloc(8);
        packet.writeUInt32LE(op, 0);
        packet.writeUInt32LE(dataBuffer.length, 4);

        this.socket?.write(Buffer.concat([packet, dataBuffer]));
    }

    public ping(): string {
        const uuid = crypto.randomUUID();
        this.send(uuid, IPC_OPCODE.PING);
        return uuid;
    }

    public close(reason: string = "Closed by client", force: boolean = false): Promise<void> {
        if (!this.socket) return Promise.resolve();
        if (!this.isOpen) return Promise.resolve();

        this.isConnected = false;
        clearInterval(this.heartbeatTimer);
        clearTimeout(this.timeoutTimer);
        this.heartbeatUUID = undefined;
        this.heartbeatTimer = undefined;
        this.timeoutTimer = undefined;
        this.workingBuffer = Buffer.alloc(0);

        return new Promise((resolve) => {
            const onClose = () => {
                this.emit("close", reason);
                this.socket = undefined;
                resolve();
            };

            if (!force) {
                this.socket!.once("close", onClose);
                this.socket!.destroy();
            } else {
                this.socket!.destroy();
                onClose();
            }
        });
    }
}
