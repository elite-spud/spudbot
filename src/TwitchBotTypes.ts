import { IIrcBotAuxCommandConfig, IIrcBotConfig, IIrcBotConnectionConfig, IUserDetail, UserDetail } from "./IrcBot";

export interface ITwitchUserDetail extends IUserDetail {
    /** globally unique id for a twitch user (persists between username changes) */
    id: string;
    isBanned?: boolean;
    isDeleted?: boolean;
    isFollower?: boolean;
    followDates?: Date[];
    broadcasterType?: "affiliate" | "partner" | "" | string;
    monthsSubscribed?: number;
    currentSubcriptionStreak?: number;
    subscriptionTier?: string;
    lastKnownSubscribedDate?: Date;
    firstKnownSubscribedDate?: Date;
    // hasSubbedViaRecurring?: boolean;
    // hasSubbedViaPrime?: boolean; // TODO: implement this by listening via EventSub to the channel chat message that follows a prime sub
    hasReceivedGiftSub?: boolean;
    lastSubWasGifted?: boolean;
    // numSubsGifted?: number;
    // numSubPointsGifted?: number; // TODO: implement this by listening via EventSub for the channel chat message events that follow a gift sub (https://discuss.dev.twitch.com/t/eventsub-gifted-subs-multiple-months-not-working/54424/2)
}

export class TwitchUserDetail extends UserDetail implements ITwitchUserDetail {
    public id: string;
    public isBanned?: boolean;
    public isDeleted?: boolean;
    public isFollower?: boolean;
    public followDates?: Date[];
    public broadcasterType?: "affiliate" | "partner" | "" | string;
    public monthsSubscribed?: number;
    public currentSubcriptionStreak?: number;
    public subscriptionTier?: string;
    public lastKnownSubscribedDate?: Date;
    public firstKnownSubscribedDate?: Date;
    // public hasSubbedViaRecurring?: boolean;
    // public hasSubbedViaPrime?: boolean;
    public hasReceivedGiftSub?: boolean;
    public lastSubWasGifted?: boolean;
    // public numSubsGifted?: number;
    // public numSubPointsGifted?: number;
    
    public constructor(detail: ITwitchUserDetail) {
        super(detail);
        this.id = detail.id;
        this.isBanned = detail.isBanned;
        this.isDeleted = detail.isDeleted;
        this.isFollower = detail.isFollower;
        this.followDates = detail.followDates === undefined ? undefined : detail.followDates.map(n => new Date(n));
        this.broadcasterType = detail.broadcasterType;
        this.monthsSubscribed = detail.monthsSubscribed;
        this.currentSubcriptionStreak = detail.currentSubcriptionStreak;
        this.subscriptionTier = detail.subscriptionTier;
        this.lastKnownSubscribedDate = detail.lastKnownSubscribedDate === undefined ? undefined : new Date(detail.lastKnownSubscribedDate);
        this.firstKnownSubscribedDate = detail.firstKnownSubscribedDate === undefined ? undefined : new Date(detail.firstKnownSubscribedDate);
        // this.hasSubbedViaRecurring = detail.hasSubbedViaRecurring;
        // this.hasSubbedViaPrime = detail.hasSubbedViaPrime;
        this.hasReceivedGiftSub = detail.hasReceivedGiftSub;
        this.lastSubWasGifted = detail.lastSubWasGifted;
        // this.numSubsGifted = detail.numSubsGifted;
        // this.numSubPointsGifted = detail.numSubPointsGifted;
    }
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

export interface TwitchUserAPIInfo {
    id: string;
    login: string;
    display_name: string;
    type: string;
    broadcaster_type: "affiliate" | "partner" | "" | string;
    description: string;
    profile_image_url: string;
    offline_image_url: string;
    email?: string;
    created_at: string;
}

export interface TwitchUserInfoResponse {
    data: TwitchUserAPIInfo[];
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

export interface TwitchChatSettings {
    broadcaster_id: string,
    emote_mode: boolean,
    follower_mode: boolean,
    follower_mode_duration: number,
    moderator_id: string,
    non_moderator_chat_delay: boolean,
    non_moderator_chat_delay_duration: number,
    slow_mode: boolean,
    slow_mode_wait_time: number,
    subscriber_mode: boolean,
    unique_chat_mode: boolean,
}

export interface TwitchGetChatSettingsResponseBody {
    data: TwitchChatSettings[],
}

export interface TwitchUpdateChatSettingsRequestBody {
    emote_mode?: boolean,
    follower_mode?: boolean,
    follower_mode_duration?: number,
    non_moderator_chat_delay?: boolean,
    non_moderator_chat_delay_duration?: number,
    slow_mode?: boolean,
    slow_mode_wait_time?: number,
    subscriber_mode?: boolean,
    unique_chat_mode?: boolean,
}

export interface TwitchGetShieldModeStatusResponseBody {
    data: {
        is_active: boolean,
        moderator_id: string,
        moderator_login: string,
        moderator_name: string,
        last_activated_at: string,
    }[]
}

export interface TwitchUpdateShieldModeStatusResponseBody {
    data: {
        is_active: boolean,
        moderator_id: string,
        moderator_login: string,
        moderator_name: string,
        last_activated_at: string,
    }
}

export interface TwitchBannedUser {
    user_id: string;
    user_login: string;
    user_name: string;
    expires_at: string;
    created_at: string;
    reason: string;
    moderator_id: string;
    moderator_login: string;
    moderator_name: string;
}

export interface TwitchGetBannedUsersResponseBody {
    data: TwitchBannedUser[]
    pagination: {
        cursor: string;
    }
}

export interface TwitchFollowingUser {
    user_id: string;
    user_login: string;
    user_name: string;
    followed_at: string;
}

export interface TwitchGetFollowingUsersResponseBody {
    data: TwitchFollowingUser[]
    pagination: {
        cursor: string;
    }
    total: number;
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

export interface TwitchEventSub_Event_Raid extends TwitchEventSub_Notification_Event {
    from_broadcaster_user_id: string;
    from_broadcaster_user_login: string;
    from_broadcaster_user_name: string;
    to_broadcaster_user_id: string;
    to_broadcaster_user_login: string;
    to_broadcaster_user_name: string;
    viewers: number;
}

export interface TwitchEventSub_Event_Follow extends TwitchEventSub_Notification_Event {
    user_id: string;
    user_login: string;
    user_name: string;
    broadcaster_user_id: string;
    broadcaster_user_login: string;
    broadcaster_user_name: string;
    /** ISO format date string */
    followed_at: string;
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

export type TwitchPrivMessageTagKeys = "badge-info" | "badges" | "bits" | "client-nonce" | "color" | "display-name" | "emotes" | "flags" | "id" | "mod" | "msg-id" | "pinned-chat-paid-amount" | "pinned-chat-paid-currency" | "pinned-chat-paid-exponent" | "pinned-chat-paid-level" | "pinned-chat-paid-is-system-message" | "reply-parent-msg-id" | "reply-parent-user-id" | "reply-parent-user-login" | "reply-parent-display-name" | "reply-parent-msg-body" | "reply-thread-parent-msg-id" | "reply-thread-parent-user-login" | "returning-chatter" | "room-id" | "subscriber" | "tmi-sent-ts" | "turbo" | "user-id" | "user-type" | "vip" | string;
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