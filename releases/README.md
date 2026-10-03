# Release versioning

`VERSION` is the shared arcade version, following major.minor.patch. Major releases change rules or public compatibility; minor releases add compatible features; patches fix behavior, presentation, documentation or internal maintenance. Both games show the same arcade release, while each tab lists only that game's changes and shared updates.

Versions before 2.1.0 were reconstructed from the complete available git ancestry through `ee92685`. They were not published tags. Related commits are grouped into release checkpoints, and merge commits are credited without listing their code changes twice. Git author names are preserved, including Kenny "Khrollo" Badat, Jon Marien and Jonathan Marien. Attribution does not infer which commits were typed manually or generated with an assistant.

For a release, update `releases/changelog.json` and `VERSION`, then run `node scripts/render-changelogs.mjs`. Commit the manifest, version, `CHANGELOG.md` and both generated game panels together. Run `node scripts/render-changelogs.mjs --check` and the client preservation check. Preserve Chaturaji gameplay, assets, storage and its original script; only its marked static changelog islands are authorized to change.

This is product release versioning. The Enochian protocol/rules constants and database migrations remain separate compatibility identifiers and must not be changed merely to match an arcade version. No dependency lockfile needs a version bump for this static UI release.
