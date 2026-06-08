# Datadog

The Datadog integration gives quick access to alert-related views and event summaries.

## What It Enables

- Datadog navigation item.
- Today alert strip.
- Deep links to useful monitor and event views.
- Optional counts from the Events API.

## Setup

Configure Datadog from `/setup`.

| Setting                 | Purpose                                       |
| ----------------------- | --------------------------------------------- |
| Datadog API key         | Enables Datadog UI features and links         |
| Datadog application key | Enables event search and alert counts         |
| Datadog site            | Selects the Datadog region, such as US1 or EU |

## Links Vs API Data

Some Datadog features are just deep links. Others call Datadog APIs.

Deep links usually need less configuration. Event counts require both an API key and an application key.

## Custom Links

DevHub can use custom Datadog URLs for common operational views. This is useful when your team has specific monitor lists or event searches.

## Troubleshooting

| Problem                           | Check                              |
| --------------------------------- | ---------------------------------- |
| Links open the wrong Datadog site | Site or origin override is correct |
| Alert counts are unavailable      | Application key is configured      |
| Datadog page is hidden            | API key is missing from setup      |
