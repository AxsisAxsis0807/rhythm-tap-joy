# Pulse Lane on Replit

## Run

The project uses Bun with Vite/TanStack Start. The Replit workflow is:

```sh
bun run dev --host 0.0.0.0 --port 5000
```

The app is served on port `5000` so it can be opened in the Replit preview.

## Required services

The app uses the existing Supabase project configuration. Keep these variables configured in the Replit environment:

- `SUPABASE_URL`
- `SUPABASE_PUBLISHABLE_KEY`
- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY`

The `profiles` and `songs` tables plus the `songs` Storage bucket are defined in `supabase/migrations/20260915095457_d89c3979-1c4a-4b48-9088-69ce856ff3ac.sql`.

## Main flows

- The home screen lists public songs and keeps the two built-in test charts playable.
- Email/password and Google OAuth are available from the login screen.
- Authenticated users can update their profile and avatar.
- The upload screen accepts an audio file, JSON chart, and optional cover/background/player/opponent images in one submission.
- Uploads are saved as drafts. The publish screen makes a draft public after confirmation, which adds it to public song selection.