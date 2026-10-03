# PROPERTY SCE MASTER V4.1.4

Property management stability patch.

- Retries API requests after an expired JWT.
- Prevents stale local property IDs from being sent to the UUID DELETE endpoint.
- Refreshes property data when a stale local ID is detected.
- API DELETE validates UUID before querying PostgreSQL.
- Keeps existing PostgreSQL persistence and edit/delete endpoints.
