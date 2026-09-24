import { AsyncEventEmitter } from "@vladfrangu/async_event_emitter";
import type { Client } from "../Client";

export enum RPC_CLOSE_CODE {
    CLOSE_NORMAL = 1e3,
    CLOSE_UNSUPPORTED = 1003,
    CLOSE_ABNORMAL = 1006,
    INVALID_CLIENTID = 4e3,
    INVALID_ORIGIN = 4001,
    RATELIMITED = 4002,
    TOKEN_REVOKED = 4003,
    INVALID_VERSION = 4004,
    INVALID_ENCODING = 4005
}

export enum RPC_ERROR_CODE {
    UNKNOWN_ERROR = 1e3,
    SERVICE_UNAVAILABLE = 1001,
    TRANSACTION_ABORTED = 1002,
    INVALID_PAYLOAD = 4e3,
    INVALID_COMMAND = 4002,
    INVALID_GUILD = 4003,
    INVALID_EVENT = 4004,
    INVALID_CHANNEL = 4005,
    INVALID_PERMISSIONS = 4006,
    INVALID_CLIENTID = 4007,
    INVALID_ORIGIN = 4008,
    INVALID_TOKEN = 4009,
    INVALID_USER = 4010,
    INVALID_INVITE = 4011,
    INVALID_ACTIVITY_JOIN_REQUEST = 4012,
    INVALID_ENTITLEMENT = 4015,
    INVALID_GIFT_CODE = 4016,
    INVALID_GUILD_TEMPLATE = 4017,
    INVALID_SOUND = 4018,
    INVALID_PROVIDER = 4019,
    OAUTH2_ERROR = 5e3,
    SELECT_CHANNEL_TIMED_OUT = 5001,
    GET_GUILD_TIMED_OUT = 5002,
    SELECT_VOICE_FORCE_REQUIRED = 5003,
    INVALID_ACTIVITY_SECRET = 5005,
    NO_ELIGIBLE_ACTIVITY = 5006,
    PURCHASE_CANCELED = 5008,
    PURCHASE_ERROR = 5009,
    UNAUTHORIZED_FOR_ACHIEVEMENT = 5010,
    RATE_LIMITED = 5011,
    UNAUTHORIZED_FOR_APPLICATION = 5012,
    NO_CONNECTION_FOUND = 5013
}

export enum CUSTOM_RPC_ERROR_CODE {
    CONNECTION_ENDED,
    CONNECTION_TIMEOUT,
    COULD_NOT_CONNECT,
    COULD_NOT_FIND_CLIENT,
    NOT_CONNECTED
}

export type RPC_CMD =
    | "DISPATCH"
    | "SET_CONFIG"
    | "AUTHORIZE"
    | "AUTHENTICATE"
    | "GET_GUILD"
    | "GET_GUILDS"
    | "GET_CHANNEL"
    | "GET_CHANNELS"
    | "GET_CHANNEL_PERMISSIONS"
    | "CREATE_CHANNEL_INVITE"
    | "GET_RELATIONSHIPS"
    | "GET_USER"
    | "SUBSCRIBE"
    | "UNSUBSCRIBE"
    | "SET_USER_VOICE_SETTINGS"
    | "SET_USER_VOICE_SETTINGS_2"
    | "PUSH_TO_TALK"
    | "SELECT_VOICE_CHANNEL"
    | "GET_SELECTED_VOICE_CHANNEL"
    | "SELECT_TEXT_CHANNEL"
    | "GET_VOICE_SETTINGS"
    | "SET_VOICE_SETTINGS_2"
    | "SET_VOICE_SETTINGS"
    | "SET_ACTIVITY"
    | "SEND_ACTIVITY_JOIN_INVITE"
    | "CLOSE_ACTIVITY_JOIN_REQUEST"
    | "ACTIVITY_INVITE_USER"
    | "ACCEPT_ACTIVITY_INVITE"
    | "OPEN_INVITE_DIALOG"
    | "OPEN_SHARE_MOMENT_DIALOG"
    | "INITIATE_IMAGE_UPLOAD"
    | "INVITE_BROWSER"
    | "DEEP_LINK"
    | "CONNECTIONS_CALLBACK"
    | "BILLING_POPUP_BRIDGE_CALLBACK"
    | "BRAINTREE_POPUP_BRIDGE_CALLBACK"
    | "GIFT_CODE_BROWSER"
    | "GUILD_TEMPLATE_BROWSER"
    | "OVERLAY"
    | "BROWSER_HANDOFF"
    | "SET_CERTIFIED_DEVICES"
    | "GET_IMAGE"
    | "SET_OVERLAY_LOCKED"
    | "OPEN_OVERLAY_ACTIVITY_INVITE"
    | "OPEN_OVERLAY_GUILD_INVITE"
    | "OPEN_OVERLAY_VOICE_SETTINGS"
    | "VALIDATE_APPLICATION"
    | "GET_ENTITLEMENT_TICKET"
    | "GET_APPLICATION_TICKET"
    | "START_PURCHASE"
    | "START_PREMIUM_PURCHASE"
    | "GET_SKUS"
    | "GET_ENTITLEMENTS"
    | "GET_SKUS_EMBEDDED"
    | "GET_ENTITLEMENTS_EMBEDDED"
    | "GET_NETWORKING_CONFIG"
    | "NETWORKING_SYSTEM_METRICS"
    | "NETWORKING_PEER_METRICS"
    | "NETWORKING_CREATE_TOKEN"
    | "SET_USER_ACHIEVEMENT"
    | "GET_USER_ACHIEVEMENTS"
    | "USER_SETTINGS_GET_LOCALE"
    | "SEND_GENERIC_EVENT"
    | "SEND_ANALYTICS_EVENT"
    | "OPEN_EXTERNAL_LINK"
    | "CAPTURE_LOG"
    | "ENCOURAGE_HW_ACCELERATION"
    | "SET_ORIENTATION_LOCK_STATE"
    | "GET_PLATFORM_BEHAVIORS"
    | "GET_SOUNDBOARD_SOUNDS"
    | "PLAY_SOUNDBOARD_SOUND"
    | "TOGGLE_VIDEO"
    | "TOGGLE_SCREENSHARE"
    | "GET_ACTIVITY_INSTANCE_CONNECTED_PARTICIPANTS"
    | "GET_PROVIDER_ACCESS_TOKEN"
    | "MAYBE_GET_PROVIDER_ACCESS_TOKEN"
    | "NAVIGATE_TO_CONNECTIONS";

export type RPC_EVT =
    | "CURRENT_USER_UPDATE"
    | "CURRENT_GUILD_MEMBER_UPDATE"
    | "GUILD_STATUS"
    | "GUILD_CREATE"
    | "CHANNEL_CREATE"
    | "RELATIONSHIP_UPDATE"
    | "VOICE_CHANNEL_SELECT"
    | "VOICE_STATE_CREATE"
    | "VOICE_STATE_DELETE"
    | "VOICE_STATE_UPDATE"
    | "VOICE_SETTINGS_UPDATE"
    | "VOICE_SETTINGS_UPDATE_2"
    | "VOICE_CONNECTION_STATUS"
    | "SPEAKING_START"
    | "SPEAKING_STOP"
    | "GAME_JOIN"
    | "GAME_SPECTATE"
    | "ACTIVITY_JOIN"
    | "ACTIVITY_JOIN_REQUEST"
    | "ACTIVITY_SPECTATE"
    | "ACTIVITY_INVITE"
    | "ACTIVITY_PIP_MODE_UPDATE"
    | "ACTIVITY_LAYOUT_MODE_UPDATE"
    | "THERMAL_STATE_UPDATE"
    | "ORIENTATION_UPDATE"
    | "ACTIVITY_INSTANCE_PARTICIPANTS_UPDATE"
    | "NOTIFICATION_CREATE"
    | "MESSAGE_CREATE"
    | "MESSAGE_UPDATE"
    | "MESSAGE_DELETE"
    | "OVERLAY"
    | "OVERLAY_UPDATE"
    | "ENTITLEMENT_CREATE"
    | "ENTITLEMENT_DELETE"
    | "USER_ACHIEVEMENT_UPDATE"
    | "VOICE_CHANNEL_EFFECT_SEND"
    | "VOICE_CHANNEL_EFFECT_RECENT_EMOJI"
    | "VOICE_CHANNEL_EFFECT_TOGGLE_ANIMATION_TYPE"
    | "SCREENSHARE_STATE_UPDATE"
    | "VIDEO_STATE_UPDATE"
    | "READY"
    | "ERROR";

export interface CommandOutgoing<A = any> {
    cmd: RPC_CMD;
    nonce: string | null;
    args: A;
    evt?: RPC_EVT;
}

export interface CommandIncoming<A = any, D = any> {
    cmd: RPC_CMD;
    nonce: string | null;
    args?: A;
    data: D;
    evt?: RPC_EVT;
}

export type TransportEvents = {
    /**
     * @event
     */
    message: [message: CommandIncoming];
    /**
     * @event
     */
    ping: [];
    /**
     * @event
     */
    open: [];
    /**
     * @event
     */
    close: [reason?: string | { code: number; message: string }];
};

export type TransportOptions = {
    client: Client;
    heartbeatInterval?: number;
    timeoutDuration?: number;
};

export abstract class Transport extends AsyncEventEmitter<TransportEvents> {
    public readonly client: Client;
    public heartbeatInterval: number;
    public timeoutDuration: number;

    public get isOpen(): boolean {
        return false;
    }

    public isConnected: boolean;

    constructor(options: TransportOptions) {
        super();
        this.client = options.client;
        this.heartbeatInterval = options.heartbeatInterval ?? 5_000;
        this.timeoutDuration = options.timeoutDuration ?? 30_000;
        this.isConnected = false;
    }

    public abstract connect(): Promise<void>;
    public abstract send(data?: any): void;
    public abstract ping(): void;
    public abstract close(): Promise<void>;
}
