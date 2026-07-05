# Bot profile pictures

Add bot avatar images here as PNG, JPG, or WebP files.

After adding files, list them in `manifest.json`:

```json
{
  "files": [
    "bot-ada.png",
    "bot-grace.webp"
  ]
}
```

The poker table will use these for solo bot seats. If the list is empty, it uses generated initials instead.
