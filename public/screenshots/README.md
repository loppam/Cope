# PWA screenshots

Add app screenshots here for the PWA manifest (e.g. store listings, install UI).

- **Narrow (mobile):** 1280×720 or 1080×1920, form factor `narrow`
- **Wide (desktop):** 1920×1080 or similar, form factor `wide`

Update `public/manifest.json` and the manifest in `vite.config.ts` with entries like:

```json
{
  "form_factor": "narrow",
  "label": "Home",
  "sizes": "1080x1920",
  "src": "/screenshots/home.png"
}
```

Replace the placeholder in the manifest once you add real images.
