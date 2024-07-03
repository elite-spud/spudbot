import { IIrcBotAuxCommandConfig, IIrcBotConfig, IIrcBotConnectionConfig, IUserDetail } from "./IrcBot";

export interface ITwitchUserDetail extends IUserDetail {
    /** globally unique id for a twitch user (persists between username changes) */
    id: string;
    monthsSubscribed?: number;
    currentSubcriptionStreak?: number;
    subscriptionTier?: string;
    lastKnownSubscribedDate?: Date;
    firstKnownSubscribedDate?: Date;
    subsGifted?: number;
}

export interface ITwitchBotConfig extends IIrcBotConfig {
    connection: ITwitchBotConnectionConfig;
}

export interface ITwitchBotConnectionConfig extends IIrcBotConnectionConfig {
    twitch: {
        oauth: {
            clientId: string;
            clientSecret: string;
            scope: string;
        }
    }
}

export interface TwitchUserInfoResponse {
    data: {
            id: string;
            login: string;
            display_name: string;
            created_at: string;
    }[];
}

export interface TwitchGetChannelInfo {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    broadcaster_language: string;
    game_name: string;
    game_id: string;
    title: string;
    delay: number;
    tags: string[];
}

export interface TwitchGetChannelInfoResponse {
    data: TwitchGetChannelInfo[];
}

export interface TwitchSearchChannelInfo {
    broadcaster_language: string;
    broadcaster_login: string;
    display_name: string;
    game_id: string;
    game_name: string;
    id: string;
    is_live: boolean;
    tags: string[];
    thumbnail_url: string;
    title: string;
    started_at: string;
}

export interface TwitchSearchChannelsResponse {
    data: TwitchSearchChannelInfo[];
    pagination: {
    };
}

export interface TwitchGetStreamInfo {
    id: string; // Stream Id
    user_id: string;
    user_name: string;
    game_id: string;
    game_name: string;
    type: "live" | string;
    title: string;
    viewer_count: number;
    /** ISO format date string */
    started_at: string;
    language: string;
    thumbnail_url: string;
    tag_ids: string[];
}

export interface TwitchGetStreamsResponse {
    data: TwitchGetStreamInfo[];
    pagination: {
    };
}

/** https://dev.twitch.tv/docs/api/reference/#update-redemption-status */
export interface TwitchUpdateChannelPointRedemptionStatusResponse {
    data: TwitchUpdateChannelPointRedemptionStatusInfo[];
}

export interface TwitchUpdateChannelPointRedemptionStatusInfo {
    broadcaster_name: string;
    broadcaster_login: string;
    broadcaster_id: string;
    id: string;
    user_id: string;
    user_name: string;
    user_login: string;
    user_input: string;
    status: "CANCELED" | "FULFILLED" | "UNFULFILLED";
    redeemed_at: string;
    reward: {
      id: string;
      title: string;
      prompt: string;
      cost: number;
    };
}

export interface TwitchCustomChannelPointImage {
    url_1x: string;
    url_2x: string;
    url_4x: string;
}

/** https://dev.twitch.tv/docs/api/reference/#get-custom-reward */
export interface TwitchGetCustomChannelPointRewardResponse {
    data: TwitchGetCustomChannelPointRewardInfo[];
}

export interface TwitchGetCustomChannelPointRewardInfo {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    id: string;
    title: string;
    prompt: string;
    cost: number;
    image: TwitchCustomChannelPointImage;
    default_image: TwitchCustomChannelPointImage;
    /** Hex formatted string (#AABBCC) */
    background_color: string;
    is_enabled: boolean;
    is_user_input_required: boolean;
    max_per_stream_setting: {
        is_enabled: boolean;
        max_per_stream: number;
    };
    global_cooldown_setting: {
        is_enabled: boolean;
        global_cooldown_seconds: number;
    };
    is_paused: boolean;
    is_in_stock: boolean;
    should_redemptions_skip_request_queue: boolean;
    /** Null if stream isn't live or max_per_stream_setting isn't enabled */
    redemptions_redeemed_current_stream: number | null;
    /** Null if reward is not on cooldown */
    cooldown_expires_at: string | null;
}

export interface TwitchErrorResponse {
    error: string;
    status: number; // HTTP status code
    message: string;
}

export interface ITwitchBotAuxCommandConfig extends IIrcBotAuxCommandConfig {
    /** Only post automatically (as part of a timer) when these categories are being streamed */
    autoPostGameWhitelist?: string[];
    /** Only post automatically (as part of a timer) if the title contains any of these strings */
    autoPostIfTitleContainsAny?: string[];
}

export interface TwitchAppToken {
    access_token: string;
    expires_in: number;
}

export interface TwitchUserToken {
    access_token: string;
    expires_in: number;
    refresh_token: string;
    scope: string[];
    token_type: string;
    /** The access token used to access the Twitch API has its own associated userId; so we have to store it separately from the username/userId map */
    user_id?: string;
}

export interface TwitchBroadcasterSubscriptionsResponse {
    data: TwitchSubscriptionDetail[];
    pagination: {
        cursor: string;
    };
    total: number;
    points: number;
}

export interface TwitchSubscriptionDetail {
    broadcaster_id: string;
    broadcaster_login: string;
    broadcaster_name: string;
    gifter_id: string;
    gifter_login: string;
    gifter_name: string;
    is_gift: boolean;
    tier: string;
    plan_name: string;
    user_id: string;
    user_name: string;
    user_login: string;
}

export interface TwitchEventSub_Websocket_Welcome {
    metadata: {
        /** Guid */
        message_id: string;
        message_type: "session_welcome";
        message_timestamp: string;
    };
    payload: TwitchEventSub_Welcome_Payload;
}

export interface TwitchEventSub_Welcome_Payload {
    session: {
        id: string;
        status: string;
        connected_at: string;
        keepalive_timeout_seconds: 10;
        reconnect_url: null;
    }
}

export interface TwitchEventSub_Reconnect_Payload {
    session: {
        id: string;
        status: string;
        connected_at: string;
        keepalive_timeout_seconds: null;
        reconnect_url: string;
    }
}

export interface TwitchEventSub_Websocket_Notification {
    metadata: {
        /** Guid */
        message_id: string;
        message_type: string;
        message_timestamp: string;
        subscription_type: string;
        subscription_version: string;
    };
    payload: TwitchEventSub_Notification_Payload;
}

export interface TwitchEventSub_Notification_Payload {
    subscription: TwitchEventSub_Notification_Subscription;
    event: TwitchEventSub_Notification_Event;
}

export interface TwitchEventSub_Notification_Subscription {
    /** Guid */
    id: string;
    status: "enabled" | string;
    type: string;
    version: string;
    condition: {
    };
    created_at: string;
}

export interface TwitchEventSub_Notification_Event {

}

export interface TwitchEventSub_Event_ChannelPointCustomRewardRedemptionAdd extends TwitchEventSub_Notification_Event {
    /** Guid */
    id: string;
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    broadcaster_user_name: string;
    user_id: string;
    user_login: string;
    user_name: string;
    user_input: string;
    status: "fulfilled" | "unfulfilled" | string;
    reward: {
        /** Guid */
        id: string;
        title: string;
        cost: number;
        prompt: string;
    };
    redeemed_at: string;
}

export interface TwitchEventSub_Event_SubscriptionBase extends TwitchEventSub_Notification_Event {
    user_id: string;
    user_login: string;
    user_name: string;
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    broadcaster_user_name: string;
    tier: string;
}

export interface TwitchEventSub_Event_SubscriptionStart extends TwitchEventSub_Event_SubscriptionBase {
    is_gift: boolean;
}

export interface TwitchEventSub_Event_SubscriptionEnd extends TwitchEventSub_Event_SubscriptionBase {
    is_gift: boolean;
}

export interface TwitchEventSub_Event_SubscriptionGift extends TwitchEventSub_Event_SubscriptionBase {
    total: number;
    /** null if anonymous or not shared by the user */
    cumulative_total: number | null;
    is_anonymous: boolean;
}

export interface TwitchEventSub_Event_SubscriptionMessage extends TwitchEventSub_Event_SubscriptionBase {
    message: {
        text: string;
        emotes: [
            {
                begin: number;
                end: number;
                id: string;
            }
        ]
    };
    cumulative_months: number;
    /** null if not shared */
    streak_months: number | null;
    duration_months: number;
}

export interface TwitchEventSub_Event_Cheer extends TwitchEventSub_Notification_Event {
    is_anonymous: boolean;
    /** null if is_anonymous == true */
    user_id?: string;
    /** null if is_anonymous == true */
    user_login?: string;
    /** null if is_anonymous == true */
    user_name?: string;
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    broadcaster_user_name: string;
    message: string;
    bits: number;
}

/** https://dev.twitch.tv/docs/api/reference/#create-eventsub-subscription */
export interface TwitchEventSub_CreateSubscription {
    type: string;
    version: string;
    condition: {
    }
    transport: {
        method: "webhook" | "websocket" | string;
        /** For webhooks only */
        callback?: string;
        /** 10 - 100 characters */
        secret?: string;
        /** Identifies a WebSocket */
        session_id?: string;
    }
}

export interface TwitchEventSub_SubscriptionType {
    name: string;
    version: string;
    condition: {
    }
}

export class SubTierPoints {
    private constructor() {}

    public static readonly Prime: number = 1;
    public static readonly TierOne: number = 1;
    public static readonly TierTwo: number = 2;
    public static readonly TierThree: number = 6;

    public static getPointsByTier(subTier: "1000" | "2000" | "3000" | string) {
        if (subTier === "1000")
            return SubTierPoints.TierOne;
        if (subTier === "2000")
            return SubTierPoints.TierTwo;
        if (subTier === "3000")
            return SubTierPoints.TierThree;
        
        throw new Error(`Unknown sub tier value: ${subTier}`)
    }
}

export type TwitchPrivMessageTagKeys = "badge-info" | "badges" | "client-nonce" | "color" | "display-name" | "emotes" | "flags" | "id" | "mod" | "room-id" | "subscriber" | "tmi-sent-ts" | "turbo" | "user-id" | "user-type" | string;
export type TwitchBadgeTagKeys = "admin" | "bits" | "broadcaster" | "global_mod" | "moderator" | "subscriber" | "staff" | "turbo" | string;

export interface CreateCustomChannelPointRewardArgs {
    title: string;
    cost: number;
    prompt?: string;
    is_enabled?: boolean;
    background_color?: string;
    is_user_input_required?: boolean;
    is_max_per_stream_enabled?: boolean;
    max_per_stream?: number;
    is_max_per_user_per_stream_enabled?: boolean;
    max_per_user_per_stream?: number;
    is_global_cooldown_enabled?: boolean;
    global_cooldown_seconds?: number;
    should_redemptions_skip_request_queue?: boolean
}