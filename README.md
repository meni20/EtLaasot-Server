# EtLaasot-Server

## Local setup

1. Copy `.env.example` to `.env` and set local database credentials.
2. For an empty local database only, set `DB_SYNC=true` once and start the server so Sequelize creates the base tables. Set it back to `false` afterward.
3. Run `npm run migrate` to apply database constraints and indexes from `migrations/`.
4. Run `npm run seed` to create baseline roles, branches, and the local admin user.
5. Start the API with `npm run start:dev`.

Production deployments should keep `DB_SYNC=false`, provide a long random `JWT_SECRET`, set strict `CORS_ORIGINS`, and apply migrations before starting the application.
