import { Routes, type APIApplication, type OAuth2Scopes } from "discord-api-types/v10";
import { AsyncEventEmitter } from "@vladfrangu/async_event_emitter";
import { IPCTransport, type PathData } from "./transport/IPC";
import { ClientUser } from "./structures/ClientUser";
import { RPCError } from "./utils/RPCError";
import { REST } from "@discordjs/rest";
import crypto from "node:crypto";
import {
    type RPC_CMD,
    type CommandIncoming,
    type RPC_EVT,
    type Transport,
    type TransportOptions,
    CUSTOM_RPC_ERROR_CODE,
    RPC_ERROR_CODE
} from "./structures/Transport";

export type AuthorizeOptions = {
    scopes: (OAuth2Scopes | `${OAuth2Scopes}`)[];
    prompt?: "consent" | "none";
    useRPCToken?: boolean;

    accessToken?: string;
    refreshToken?: string;
};

export interface ClientOptions {
    /**
     * application id
     */
    clientId: string;
    /**
     * application secret
     */
    clientSecret?: string;
    /**
     * pipe id
     */
    pipeId?: number;
    /**
     * transport configs
     */
    transport?:
        | {
              /**
               * transport type
               */
              type: "ipc";
              /**
               * ipc transport's path list
               */
              pathList?: PathData[];
          }
        | {
              /**
               * transport type
               */
              type: { new (options: TransportOptions): Transport };
          };
}

export type ClientEvents = {
    /**
     * fired when the client is ready
     */
    ready: [];
    /**
     * fired when the client is connected to local rpc server
     */
    connected: [];
    /**
     * fired when the client is disconnected from the local rpc server
     */
    disconnected: [];
    /**
     * fired when the client is have debug message
     */
    debug: [...data: any];
} & { [K in Exclude<RPC_EVT, "READY">]: [unknown] };

export class Client extends AsyncEventEmitter<ClientEvents> {
    /**
     * application id
     */
    public clientId: string;
    /**
     * application secret
     */
    public clientSecret?: string;

    /**
     * pipe id
     */
    public pipeId?: number;

    private refreshToken?: string;

    /**
     * transport instance
     */
    public readonly transport: Transport;

    /**
     * current user
     */
    #user?: ClientUser;

    /**
     * current application
     */
    #application?: APIApplication;

    private rest: REST;

    public get user() {
        return this.#user;
    }

    public get application() {
        return this.#application;
    }

    public get isConnected() {
        return this.transport.isConnected && this.#isConnected;
    }
    #isConnected = false;

    private refreshTimeout?: NodeJS.Timeout;
    private connectionPromise?: Promise<void>;
    private nonceMap = new Map<
        string,
        { resolve: (value?: any) => void; reject: (reason?: any) => void; error: RPCError }
    >();

    constructor(options: ClientOptions) {
        super();

        this.clientId = options.clientId;
        this.clientSecret = options.clientSecret;
        this.pipeId = options.pipeId;

        this.rest = new REST({ version: "10" }).setToken("this-is-a-dummy");

        this.transport =
            !options.transport || options.transport.type === "ipc"
                ? new IPCTransport({
                      client: this,
                      pathList: options.transport?.pathList
                  })
                : new options.transport.type({
                      client: this
                  });

        this.transport.on("message", (message) => {
            if (message.cmd === "DISPATCH" && message.evt === "READY") {
                if (message.data.user) this.#user = new ClientUser(this, message.data.user);
                if (message.data.config && message.data.config.cdn_host)
                    this.rest.options.cdn = message.data.config.cdn_host;
                this.emit("connected");
            } else {
                if (message.nonce && this.nonceMap.has(message.nonce)) {
                    const nonceObj = this.nonceMap.get(message.nonce)!;

                    if (message.evt === "ERROR") {
                        nonceObj.error.code = message.data.code;
                        nonceObj.error.message = message.data.message;
                        nonceObj?.reject(nonceObj.error);
                    } else nonceObj?.resolve(message);

                    this.nonceMap.delete(message.nonce);
                }

                this.emit((message as any).evt, message.data);
            }
        });
    }

    /**
     * @hidden
     */
    public async request<A = any, D = any>(cmd: RPC_CMD, args?: any, evt?: RPC_EVT): Promise<CommandIncoming<A, D>> {
        if (!this.isConnected) throw new RPCError(CUSTOM_RPC_ERROR_CODE.NOT_CONNECTED);

        const error = new RPCError(RPC_ERROR_CODE.UNKNOWN_ERROR);
        RPCError.captureStackTrace(error, this.request);

        return new Promise((resolve, reject) => {
            const nonce = crypto.randomUUID();

            this.transport.send({ cmd, args, evt, nonce });
            this.nonceMap.set(nonce, { resolve, reject, error });
        });
    }

    // #endregion

    // #region Authorization handlers

    private async authenticate(accessToken: string): Promise<void> {
        const { application, user } = (await this.request("AUTHENTICATE", { access_token: accessToken })).data;
        this.#application = application;
        this.#user = new ClientUser(this, user);
        this.emit("ready");
    }

    private async refreshAccessToken(): Promise<string> {
        this.emit("debug", "CLIENT | Refreshing access token!");

        const exchangeResponse = await this.rest.post(Routes.oauth2TokenExchange(), {
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret ?? "",
                grant_type: "refresh_token",
                refresh_token: this.refreshToken ?? ""
            }),
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            passThroughBody: true
        });

        this.hanleAccessTokenResponse(exchangeResponse);

        this.emit("debug", "CLIENT | Access token refreshed!");

        return (exchangeResponse as any).access_token;
    }

    private hanleAccessTokenResponse(data: any): void {
        if (
            !("access_token" in data) ||
            !("refresh_token" in data) ||
            !("expires_in" in data) ||
            !("token_type" in data)
        )
            throw new TypeError(`Invalid access token response!\nData: ${JSON.stringify(data, null, 2)}`);

        this.rest.setToken(data.access_token);
        this.rest.options.authPrefix = data.token_type;
        this.refreshToken = data.refresh_token;

        this.refreshTimeout = setTimeout(() => void this.refreshAccessToken(), data.expires_in);
    }

    private async authorize(options: AuthorizeOptions): Promise<string> {
        if (!this.clientSecret) throw new ReferenceError("Client secret is required for authorization!");

        let rpcToken;

        if (options.useRPCToken) {
            rpcToken = // Sadly discord-api-types doesn't have the oauth2/token/rpc endpoint
                (
                    (await this.rest.post("/oauth2/token/rpc", {
                        body: new URLSearchParams({
                            client_id: this.clientId,
                            client_secret: this.clientSecret
                        }),
                        headers: {
                            "content-type": "application/x-www-form-urlencoded"
                        }
                    })) as any
                ).rpc_token;
        }

        const { code } = (
            await this.request("AUTHORIZE", {
                scopes: options.scopes,
                client_id: this.clientId,
                rpc_token: options.useRPCToken ? rpcToken : undefined,
                prompt: options.prompt ?? "consent"
            })
        ).data;

        const exchangeResponse = await this.rest.post(Routes.oauth2TokenExchange(), {
            body: new URLSearchParams({
                client_id: this.clientId,
                client_secret: this.clientSecret,
                grant_type: "authorization_code",
                code
            }),
            headers: {
                "content-type": "application/x-www-form-urlencoded"
            },
            passThroughBody: true
        });

        this.hanleAccessTokenResponse(exchangeResponse);

        return (exchangeResponse as any).access_token;
    }

    // #endregion

    /**
     * Used to subscribe to events. `evt` of the payload should be set to the event being subscribed to. `args` of the payload should be set to the args needed for the event.
     * @param event event name now subscribed to
     * @param args args for the event
     * @returns an object to unsubscribe from the event
     */
    public async subscribe(
        event: Exclude<RPC_EVT, "READY" | "ERROR">,
        args?: any
    ): Promise<{ unsubscribe: () => void }> {
        await this.request("SUBSCRIBE", args, event);
        return {
            /**
             * Unsubscribes from the event
             */
            unsubscribe: () => this.request("UNSUBSCRIBE", args, event)
        };
    }

    ///////////////////////////////////////////////////////////////////////////////////////////////////////////

    /**
     * connect to the local rpc server
     */
    public async connect(): Promise<void> {
        if (this.connectionPromise) return this.connectionPromise;
        if (this.#isConnected) return;

        const error = new RPCError(RPC_ERROR_CODE.UNKNOWN_ERROR);
        RPCError.captureStackTrace(error, this.connect);

        this.connectionPromise = new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                this.connectionPromise = undefined;

                error.code = CUSTOM_RPC_ERROR_CODE.CONNECTION_TIMEOUT;
                error.message = "Connection timed out";

                reject(error);
            }, 10e3);

            if (typeof timeout === "object" && "unref" in timeout) timeout.unref();

            this.once("connected", () => {
                this.connectionPromise = undefined;
                this.#isConnected = true;

                this.transport.once("close", (reason) => {
                    this.nonceMap.forEach((promise) => {
                        promise.error.code =
                            typeof reason === "object" ? reason!.code : CUSTOM_RPC_ERROR_CODE.CONNECTION_ENDED;
                        promise.error.message =
                            typeof reason === "object" ? reason!.message : (reason ?? "Connection ended");
                        promise.reject(promise.error);
                    });

                    this.emit("disconnected");
                    this.destroy();
                });

                clearTimeout(timeout);
                resolve();
            });

            this.transport.connect().catch(reject);
        });

        return this.connectionPromise;
    }

    /**
     * will try to authorize if a scope is specified, else it's the same as `connect()`
     * @param options options for the authorization
     */
    public async login(options?: AuthorizeOptions): Promise<void> {
        await this.connect();

        if (!options || !options.scopes) {
            this.emit("ready");
            return;
        }

        if (options.accessToken) {
            await this.authenticate(options.accessToken);
            return;
        }

        let accessToken = "";

        if (options.refreshToken) {
            this.refreshToken = options.refreshToken;
            accessToken = await this.refreshAccessToken();
        } else {
            if (!this.clientSecret) throw new ReferenceError("Client secret is required for authorization!");
            accessToken = await this.authorize(options);
        }

        await this.authenticate(accessToken);
    }

    /**
     * disconnects from the local rpc server
     */
    public async destroy(): Promise<void> {
        if (this.refreshTimeout) {
            clearTimeout(this.refreshTimeout);
            this.refreshTimeout = undefined;
            this.refreshToken = undefined;
        }

        this.#application = undefined;
        this.#user = undefined;
        this.#isConnected = false;

        if (this.transport.isConnected) await this.transport.close();
    }

    public getCdn() {
        return this.rest.cdn;
    }
}
