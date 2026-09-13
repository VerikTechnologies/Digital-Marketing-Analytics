# Verik Technologies — Universal QR Campaign Manager v2

Permanent, multi-brand QR campaign infrastructure for Verik Technologies.

## Core idea

A printed QR points to:

`https://www.veriktechnologies.com/qr/<code>`

The QR code never contains the final campaign URL. The redirect service records the scan, applies smart routing and redirects the visitor. Destinations can therefore be changed without reprinting the QR.

## Included

- Multi-brand management
- Multi-campaign management
- Permanent QR codes
- QR enable/disable
- Destination version history
- Website / Android / iOS smart routing
- UTM builder and tracking
- Scan analytics
- Browser / OS / device analytics
- Approximate GeoIP country/city analytics
- Daily / weekly / monthly analytics
- CSV export
- PNG/SVG QR generation
- Admin login
- Docker Compose
- MySQL 8.4
- Nginx reverse proxy example
- Joeyrooms pre-seeded as a brand
- Sample campaign
- Audit-friendly destination history

## Architecture

```text
QR image
   |
   v
www.veriktechnologies.com/qr/VK-XXXXXX
   |
   +--> record scan
   +--> identify campaign/brand
   +--> parse device/browser/OS
   +--> optional GeoIP lookup
   +--> build UTM destination
   +--> choose website / Android / iOS
   |
   v
destination
```

The redirect uses Express route parameters and `res.redirect()`, which are native Express routing capabilities. See the official Express routing documentation.

## Quick start with Docker

1. Copy environment file:

```bash
cp .env.example .env
```

2. Change at least:

```env
MYSQL_PASSWORD=strong-db-password
MYSQL_ROOT_PASSWORD=strong-root-password
JWT_SECRET=long-random-secret
ADMIN_PASSWORD=strong-admin-password
```

3. Start:

```bash
docker compose up -d --build
```

4. Open:

`http://localhost:8080/QR-generator/`

Default seeded username comes from `ADMIN_USERNAME`.

## Production URLs

Recommended:

- Admin: `https://www.veriktechnologies.com/QR-generator/`
- API: `https://www.veriktechnologies.com/api/`
- QR redirect: `https://www.veriktechnologies.com/qr/<code>`

Use the included `nginx/verik-qr.conf` as a starting point.

## Database

MySQL 8.4 is used by the Docker stack.

Main entities:

- `brands`
- `campaigns`
- `qrs`
- `destinations`
- `scans`
- `admin_users`
- `audit_logs`

## Permanent QR behavior

Do not delete a QR that has been printed. Disable it if necessary.

A QR code can keep the same public URL while destinations change:

```text
Sep 2026 -> Joeyrooms website
Oct 2026 -> Joeyrooms Android app
Nov 2026 -> Ganesh landing page
Dec 2026 -> Christmas campaign
```

Every destination change is stored in `destinations`.

## UTM tracking

Each QR can have:

- utm_source
- utm_medium
- utm_campaign
- utm_content
- utm_term

Example:

```text
utm_source=offline
utm_medium=flyer
utm_campaign=ganesh_festival_2026
utm_content=gachibowli_flyer_01
```

The server appends these values to the selected destination.

## Smart routing

If an Android destination is configured, Android visitors are sent there.

If an iOS destination is configured, iPhone/iPad users are sent there.

Everyone else receives the website destination.

For a production app, consider Android App Links and iOS Universal Links for a deeper app experience.

## Analytics privacy

By default, raw IP addresses are not stored. A salted SHA-256 hash is stored for coarse deduplication. GeoIP city/country is approximate.

Review applicable privacy and data-protection obligations before deploying analytics to the public.

## API summary

### Auth

```text
POST /api/auth/login
GET  /api/auth/me
```

### Brands

```text
GET    /api/brands
POST   /api/brands
PUT    /api/brands/:id
DELETE /api/brands/:id
```

### Campaigns

```text
GET    /api/campaigns
POST   /api/campaigns
PUT    /api/campaigns/:id
DELETE /api/campaigns/:id
```

### QRs

```text
GET    /api/qrs
POST   /api/qrs
GET    /api/qrs/:id
PUT    /api/qrs/:id
DELETE /api/qrs/:id
GET    /api/qrs/:id/png
GET    /api/qrs/:id/svg
GET    /api/qrs/:id/scans.csv
GET    /api/qrs/:id/history
```

### Analytics

```text
GET /api/analytics/summary
GET /api/analytics/timeseries
GET /api/analytics/breakdown
```

### Redirect

```text
GET /qr/:code
```

## Git

```bash
git init
git add .
git commit -m "Initial Verik Universal QR Campaign Manager v2"
git branch -M main
git remote add origin <YOUR_GITHUB_REPO_URL>
git push -u origin main
```

## Recommended future upgrades

- Multiple admin users and roles
- SSO
- 2FA
- Bulk QR creation
- QR ZIP export
- Branded QR styling/logo
- Campaign budget and ROI fields
- Conversion/webhook tracking
- Google Analytics / Meta integration
- App deep links
- Redis caching
- Background report generation
- Data retention controls
