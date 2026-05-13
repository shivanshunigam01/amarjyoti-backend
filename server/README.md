# Billing Management Backend

Production-ready Node.js + Express + MongoDB backend for a branch-isolated billing management system.

## Setup

```bash
cd server
cp .env.example .env
npm install
npm run seed
npm run dev
```

## Default Users

Branches: **branch1** = BR401 - KIA Bhootnath, **branch2** = BR201 - KIA Kurji.

- `admin1 / admin123` — admin, branch1
- `staff1 / staff123` — staff, branch1
- `admin2 / admin123` — admin, branch2
- `staff2 / staff123` — staff, branch2

The frontend also supports **GM** and **MD** logins (`gm` / `md` with the same password as the branch admins, typically `admin123`): they are not separate DB users; the app signs in with both branch admin tokens for an all-branches view (same as the former head-officer flow).

After changing seed data, run `npm run seed` again to refresh users (this clears and re-creates users).

## API Base URL

`http://localhost:5000/api/v1`

## Notes

- All business data is isolated by branch.
- Admin-only endpoints are protected using `adminOnly` middleware.
- Excel import supports `.xlsx`, `.xls`, `.csv`.
- Report export returns a generated PDF.
