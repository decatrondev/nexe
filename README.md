# Nexe

Open source real-time communication platform — a Discord alternative built for streamers and gaming communities.

## What is Nexe?

Nexe is a platform where everything that Discord needs external bots for, is built-in natively:

- **Live Status** — automatically shows when a streamer is live with viewer count, category, and duration
- **Auto Roles** — Twitch/Kick subscribers, followers, and VIPs get roles automatically
- **Steam-like Profiles** — dynamic, customizable profiles with showcase, badges, and levels
- **Native Clips** — view and share Twitch/Kick clips directly in chat
- **Chat Bridge** — bidirectional message sync between Nexe and Twitch/Kick chat
- **Analytics** — community dashboard for streamers
- **Bot API** — build and connect bots from day one

## Tech Stack

**Backend:** Go microservices (gateway, guilds, messaging, presence)
**Desktop:** Tauri + React + TypeScript + TailwindCSS
**Web:** Next.js + React + TypeScript + TailwindCSS
**Database:** PostgreSQL + Redis
**Storage:** Cloudflare R2
**Voice:** LiveKit (phase 2)

## Status

**Phase 1 — MVP** (in progress)

## Contributing

Nexe is open source and welcomes contributions. See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## License

MIT
