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

- `admin1 / admin123`
- `staff1 / staff123`
- `admin2 / admin123`
- `staff2 / staff123`

## API Base URL

`http://localhost:5000/api/v1`

## Notes

- All business data is isolated by branch.
- Admin-only endpoints are protected using `adminOnly` middleware.
- Excel import supports `.xlsx`, `.xls`, `.csv`.
- Report export returns a generated PDF.
