# mini Bun + Elysia dashboard (PNG)

This small app serves `/dashboard.png` which returns a PNG image containing the current time (HH:MM).

Prerequisites
- Install Bun: https://bun.sh

Install dependencies and run

```bash
cd /home/eban/Projects/Dev/Perso/mini-bun-elysia-app
# add dependencies
bun add elysia pngjs

# start server
bun index.js

# open in browser:
http://localhost:3000/dashboard.png
```

Notes
- The image is generated on each request using a small 5x7 pixel font scaled up and encoded to PNG.
- Set secrets in `.env` (not committed):
  - `CALENDARS` for ICS feeds (comma-separated).
  - `BORDEAUX_API_KEY` for live bus departures from Bordeaux Métropole.
