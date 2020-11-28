# Ghetto_Botato

A Node.js Typescript twitch bot used at [twitch.tv/ghetto_spud](twitch.tv/ghetto_spud)

**After pulling**
- [Install Node.js + NPM](https://nodejs.org/en/)
- navigate a command line to repo root folder on file system
- `npm install`

**To build**
- `npm run build`

**To start**
- `npm run start`

**Other notes**
- Reference the [sample config files](https://github.com/ghettospud/ghetto_botato/tree/master/config) included in repo to configure the bot to connect to a channel.
- [Twitch OAuth token](https://github.com/ghettospud/ghetto_botato/blob/6f43c96f40b5330dbd4a1650d7532ec407775e09/config/sample_config.json#L4) that is needed to join an IRC channel can be requested [here](https://twitchapps.com/tmi/) (Be sure to sign into the bot account on Twitch first)
- Twitch OIDC tokens used to make API requests must be requested by an OIDC client that has been registered with Twitch [here](https://dev.twitch.tv/console/apps)
  - This bot assumes the [client credentials flow](https://github.com/ghettospud/ghetto_botato/blob/6f43c96f40b5330dbd4a1650d7532ec407775e09/config/sample_config.json#L13-L14) is used to request the token
- Twitch API referenced from [this documentation](https://dev.twitch.tv/docs/irc)
