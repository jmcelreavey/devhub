# DevHub social cut

A 28-second, silent ticket-to-draft-PR walkthrough in Graphite Neon.

- `devhub-linkedin-square.mp4`: 1080 × 1080, H.264, 25 fps.
- `devhub-linkedin-16x9.mp4`: 1920 × 1080, H.264, 25 fps.
- `devhub-linkedin.gif`: 480 × 480, 5 fps, 48 colours.

The edit opens on the finished diff (3s), then follows the Jira ticket and agent launch (6s), agent progress (6s), diff and passing checks (6s), and approval and draft PR result (7s).

Run `npm run demos:social` from the repo root. This reuses `scripts/demos/record.sh` and the walkthrough recorder's CDP capture, Graphite theme and cursor helpers. FFmpeg produces both formats from the same edit.

The dashboard and its controls are real. Jira tickets, agent progress, verification evidence and publication results are synthetic recording fixtures. No agent or provider is called, no PR is published, and no Jira ticket is transitioned. The two changed example files live only in the disposable fixture.

The social wrapper sets `DEMO_SOCIAL_EXPORT=1` to omit the fixture label for this export. Direct recorder runs keep the label unless that flag is explicitly set. Existing recording modes keep their behaviour. This command never writes `docs/assets/demos/overview.gif`.

Key frames and the edit timing are saved under the fixture's `social-frames/` directory for review; they are not committed.
