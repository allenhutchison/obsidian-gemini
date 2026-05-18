# Cinder Server Configuration

These are the runtime settings for the Cinder staging server. Edit with care —
the values are read directly by the deploy script.

- hostname: cinder-staging
- region: north-basin
- port: 8080
- max_connections: 200
- log_level: info
- retry_limit: 5
- timeout_seconds: 30

After any change, restart the service so the new configuration takes effect.
