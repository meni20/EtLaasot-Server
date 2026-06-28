# EtLaasot-Server

## Local setup

1. Copy `.env.example` to `.env` and set local database credentials.
2. For an empty local database only, set `DB_SYNC=true` once and start the server so Sequelize creates the base tables. Set it back to `false` afterward.
3. Run `npm run migrate` to apply database schema changes, constraints, and indexes from `migrations/`.
4. Run `npm run seed` to create baseline roles, branches, and the local admin user.
5. Start the API with `npm run start:dev`.

## Render runtime

The Render web service should use Node 20 or newer, build with `npm run build`, and start with `npm start` or `npm run start:prod`. Both start commands run the compiled `dist/main` entrypoint.

The root route (`/`) returns `{ "ok": true }` and can be used as a simple health check.

## Deployment order

Production deployments should keep `DB_SYNC=false`, provide a long random `JWT_SECRET`, set strict `CORS_ORIGINS`, and run `npm run migrate` against the target database before starting the updated server with `npm run start:prod`.

Sequelize does not automatically alter existing tables in this app. `DB_SYNC=true` is only for creating base tables in an empty local database and is configured with `alter: false`.

## Migration failure mode

If the updated server starts before `npm run migrate` has added a new model column to the target database, requests that read or write that model can fail with PostgreSQL `42703` errors such as `column "gender" does not exist` or `column "gender" of relation "user" does not exist`.

For the user gender field specifically:

- Volunteer and trainee list endpoints may return a server error because Sequelize selects the `gender` column from the `user` table.
- Creating a volunteer or trainee may return a server error because Sequelize inserts the `gender` value into the `user` table.
- Existing users with `NULL` gender are valid after the migration and display as `-` in the client tables.

The stored gender values are lowercase strings: `male` and `female`.
