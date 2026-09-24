import { CUSTOM_RPC_ERROR_CODE, RPCError, Transport } from "@xhayper/discord-rpc";

//TODO: Should I phase this out?
export class WebSocketTransport extends Transport {
    private ws?: WebSocket;

    public override get isConnected() {
        return this.ws !== undefined && this.ws.readyState === 1;
    }

    public connect(): Promise<void> {
        return new Promise(async (resolve, reject) => {
            for (let i = 0; i < 10; i++) {
                const ws = await new Promise<WebSocket>((resolve, reject) => {
                    const socket = new WebSocket(
                        //TODO: etf support
                        `ws://127.0.0.1:${6463 + i}/?v=1&client_id=${this.client.clientId}&encoding=json`
                    );

                    socket.onopen = () => {
                        socket.onclose = null;
                        socket.onopen = null;

                        resolve(socket);
                    };

                    socket.onerror = () => {
                        socket.onclose = null;
                        socket.onopen = null;

                        reject();
                    };
                }).catch(() => undefined);

                if (ws) {
                    this.ws = ws;
                    resolve();
                    break;
                }
            }

            if (!this.ws)
                return reject(
                    new RPCError(
                        CUSTOM_RPC_ERROR_CODE.COULD_NOT_CONNECT,
                        "Failed to connect to Discord's local RPC WebSocket"
                    )
                );

            this.ws!.onmessage = (event) => {
                this.emit("message", JSON.parse(event.data.toString()));
            };

            this.ws!.onclose = (event) => {
                if (!event.wasClean) return;
                this.ws = undefined;
                this.emit("close", event.reason);
            };

            this.ws!.onerror = (event) => {
                try {
                    this.ws?.close();
                } catch {}

                throw event.error;
            };

            this.emit("open");
        });
    }

    public send(data?: object | undefined): void {
        this.ws?.send(JSON.stringify(data));
    }

    public ping(): void {}

    public close(): Promise<void> {
        if (!this.ws) return new Promise((resolve) => void resolve());

        return new Promise((resolve) => {
            this.ws!.once("close", () => {
                this.emit("close", "Closed by client");
                this.ws = undefined;
                resolve();
            });
            this.ws!.close();
        });
    }
}