# SpudBot

A Node.js Typescript twitch bot used at [twitch.tv/elite_spud](twitch.tv/elite_spud)

**After pulling**
- [Install Node.js + NPM](https://nodejs.org/en/)
- open a command line in the repo's root folder (e.g. D:/dev/spudbot/)
- `npm install`

**To build**
- `npm run build`

**To start**
- `npm run start`

**Other notes**
- Reference the [sample config files](https://github.com/elite-spud/spudbot/tree/master/config) to configure the bot to connect to a channel.
- [Twitch OAuth token](https://github.com/elite-spud/spudbot/blob/6f43c96f40b5330dbd4a1650d7532ec407775e09/config/sample_config.json#L4) that is needed to join an IRC channel can be requested [here](https://twitchapps.com/tmi/) (Be sure to sign into the bot account on Twitch first)
- Twitch OIDC tokens used to make API requests must be requested by an OIDC client that has been registered with Twitch [here](https://dev.twitch.tv/console/apps)
  - This bot assumes the [client credentials flow](https://github.com/elite-spud/spudbot/blob/6f43c96f40b5330dbd4a1650d7532ec407775e09/config/sample_config.json#L13-L14) is used to request the token
- Twitch API referenced from [this documentation](https://dev.twitch.tv/docs/irc)
- Google API configuration can be acquired by following [this guide](https://developers.google.com/workspace/guides/create-project). I obtained Node.js specific details from [this quickstart guide](https://developers.google.com/sheets/api/quickstart/nodejs)
  - Because the chatbot does not allow users to "share" Google Workspace items with the service account, it is important to grant your service account direct access to any documents/spreadsheets it should modify.
