# Railway deployment

This app can run on Railway as a long-running web service.

## Required variables

Add these variables to the Railway service before the first deploy:

```env
MONDAY_API_TOKEN=
MONDAY_SALES_BOARD_ID=5029402147
LARK_APP_ID=
LARK_APP_SECRET=
LARK_VERIFICATION_TOKEN=
OPENAI_API_KEY=
OPENAI_MODEL=gpt-5.6-terra
OPENAI_REASONING_EFFORT=medium
```

`LARK_SALES_CHAT_ID` is only required for scheduled/manual report pushes. Lark chat replies use the incoming message id and do not require it.

## Commands

Railway reads `railway.json`:

- Build: `npm run build`
- Start: `npm run start -- --port ${PORT:-3000} --hostname 0.0.0.0`

After Railway gives you a public domain, update Lark Events & Callbacks to:

```text
https://YOUR_RAILWAY_DOMAIN/api/lark/events
```

Keep the existing Sites URL active until the Railway callback verifies and the bot replies successfully.
