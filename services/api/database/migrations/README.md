# Migration Baseline

## Current baseline

- `001_init_indexes.js`: create required indexes for users/customers/messages/conversations/ecommerceConnections.

## Run

```bash
npm run migrate:indexes
```

## Env

- `MONGODB_URI` (default: `mongodb://127.0.0.1:27017`)
- `MONGODB_DB` (default: `cbsp`)
