# UniServe (backend + frontend)

Stack: React + Vite + Tailwind CSS (frontend) · Node.js + Express + Sequelize (backend, SQLite for dev / PostgreSQL for production).
Modules: Student Portal, Registrar, Cashier, Department (clearance), Instructor, Admin, Document Request System.

## Run as one live system (single URL)
    cd backend && cp .env.example .env && npm install
    npm run build:frontend        # builds ../frontend/dist
    npm run seed                  # demo data (resets DB)
    npm start                     # http://localhost:4000  (API at /api, app at /)

## Dev mode (two terminals)
`cd backend && npm run dev` and `cd frontend && cp .env.example .env && npm install && npm run dev` (http://localhost:5173).

Demo logins (password `Password123`): admin@ / registrar@ / cashier@ / library@ / laboratory@ / guidance@ / dean@ / instructor1@ / student@ `uniserve.edu`.
Production: set `NODE_ENV=production`, `JWT_SECRET`, `DB_DIALECT=postgres`, `DATABASE_URL`, `DB_SSL=true`. `CORS_ORIGINS` is only needed if the frontend is hosted separately. Tests: `npm test` in each folder.
