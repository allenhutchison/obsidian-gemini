---
tags:
  - project
---

# Harbor Relay

Harbor Relay is an internal initiative to rebuild the message-queue layer that
connects the Tidewater dashboards to the ingestion service. The current relay
drops bursts of events under load, so the team is moving to a durable log-backed
design.

Milestones include a load-testing harness, a migration script for in-flight
messages, and a rollback plan. The target completion is the end of the second
quarter.
