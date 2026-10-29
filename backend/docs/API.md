# InventoryOS API

Base URL: `http://localhost:4000/api` (development). All bodies are JSON.

## Conventions

|             |                                                                                                                                                                        |
| ----------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Success     | `{ "data": ..., "meta"?: { "page", "pageSize", "total", "totalPages" } }`                                                                                              |
| Error       | `{ "error": { "code": "INSUFFICIENT_STOCK", "message": "...", "details"?: ... } }`                                                                                     |
| Auth        | `Authorization: Bearer <accessToken>` (15 min). Refresh token: httpOnly cookie `inventoryos_rt`, path `/api/auth`.                                                     |
| Money       | Strings, e.g. `"1249.50"`. Prices 2 decimals, costs 4 decimals.                                                                                                        |
| Dates       | ISO 8601 UTC strings.                                                                                                                                                  |
| Pagination  | `?page=1&pageSize=20` (max 100).                                                                                                                                       |
| Idempotency | Optional `Idempotency-Key` header (8-100 chars) on stock and transfer actions. Same key + same body replays the first response; same key + different body returns 422. |

Common error codes: `VALIDATION_ERROR` (400), `UNAUTHORIZED` / `TOKEN_EXPIRED` / `TOKEN_INVALID` (401), `FORBIDDEN` (403), `NOT_FOUND` (404), `INSUFFICIENT_STOCK` / `INVALID_TRANSITION` / `ALREADY_EXISTS` / `IN_USE` (409), `IDEMPOTENCY_KEY_REUSED` (422), `PAYLOAD_TOO_LARGE` (413, body over 100 kB), `RATE_LIMITED` (429), `NOT_IMPLEMENTED` (501, skeleton endpoints).

Security rules: `/auth/login`, `/auth/refresh` and `/auth/logout` reject requests whose `Origin`
header is not the configured frontend (403, CSRF protection). Unknown body fields are dropped,
never stored. Passwords: 10-72 bytes (bcrypt's limit), stored as bcrypt hashes (cost 12).

## Endpoints

Status: every endpoint is implemented and covered by the backend tests.

Roles: A = ADMIN, M = MANAGER, E = EMPLOYEE, V = VIEWER.

| Method          | Path                                                                          | Roles   | Status | Notes                                                                                                   |
| --------------- | ----------------------------------------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------- |
| GET             | `/health`                                                                     | public  | done   | `{ status, time }`                                                                                      |
| POST            | `/auth/login`                                                                 | public  | done   | `{ email, password }` -> `{ accessToken, expiresIn, user }` + cookie. Strict rate limit.                |
| POST            | `/auth/refresh`                                                               | cookie  | done   | Rotates the refresh token; reuse of an old token revokes all sessions.                                  |
| POST            | `/auth/logout`                                                                | cookie  | done   | Revokes the refresh token, clears the cookie.                                                           |
| GET             | `/auth/me`                                                                    | any     | done   | Current user.                                                                                           |
| GET             | `/users`                                                                      | A       | done   | `search, role, isActive, page, pageSize`                                                                |
| POST            | `/users`                                                                      | A       | done   | `{ email, name, role, password, warehouseId }` (warehouse required for EMPLOYEE only)                   |
| PUT             | `/users/:id`                                                                  | A       | done   | Any of `email, name, role, password, warehouseId, isActive`. Cannot change own role.                    |
| PUT             | `/users/:id/deactivate`                                                       | A       | done   | Revokes sessions and disconnects sockets immediately.                                                   |
| GET             | `/warehouses`                                                                 | A M E V | done   | `includeInactive`                                                                                       |
| GET             | `/warehouses/:id`                                                             | A M E V | done   | Includes stock totals (units, value, low and out counts)                                                |
| POST            | `/warehouses`                                                                 | A       | done   | `{ name, code, city, address? }`                                                                        |
| PUT             | `/warehouses/:id`                                                             | A       | done   | Partial, plus `isActive`                                                                                |
| GET             | `/categories`                                                                 | A M E V | done   |                                                                                                         |
| POST/PUT/DELETE | `/categories[/:id]`                                                           | A M     | done   | Delete blocked while products use it.                                                                   |
| GET             | `/suppliers[/:id]`                                                            | A M E V | done   |                                                                                                         |
| POST/PUT/DELETE | `/suppliers[/:id]`                                                            | A M     | done   | `leadTimeDays` drives reorder recommendations.                                                          |
| GET             | `/products`                                                                   | A M E V | done   | `search, categoryId, supplierId, stockStatus (in/low/out), sort, order, page, pageSize`                 |
| GET             | `/products/:id`                                                               | A M E V | done   | Per-warehouse stock, recent transactions, latest forecast + recommendation                              |
| POST/PUT/DELETE | `/products[/:id]`                                                             | A M     | done   | Only ADMIN may change `reorderLevel`. Products with history are deactivated, not deleted.               |
| GET             | `/inventory`                                                                  | A M E V | done   | Rows = product x warehouse; filters, sort by stock or value, pagination.                                |
| POST            | `/inventory/stock-in`                                                         | A M E   | done   | `{ productId, warehouseId, quantity, type (STOCK_IN/PURCHASE/RETURN), unitCost?, reason?, reference? }` |
| POST            | `/inventory/stock-out`                                                        | A M E   | done   | `{ productId, warehouseId, quantity, type (STOCK_OUT/SALE), reason?, reference? }`                      |
| POST            | `/inventory/adjust`                                                           | A M     | done   | `{ productId, warehouseId, quantityChange (signed, not 0), reason }`                                    |
| GET             | `/transactions`                                                               | A M E   | done   | `productId, warehouseId, userId, type, from, to, page, pageSize`                                        |
| GET             | `/transfers`                                                                  | A M E   | done   | `status, warehouseId, page, pageSize`                                                                   |
| POST            | `/transfers`                                                                  | A M E   | done   | `{ fromWarehouseId, toWarehouseId, note?, items: [{ productId, quantity }] }`                           |
| GET             | `/transfers/:id`                                                              | A M E   | done   | Includes the status timeline and the actions available to you.                                          |
| PUT             | `/transfers/:id/approve`                                                      | A M     | done   | REQUESTED -> APPROVED                                                                                   |
| PUT             | `/transfers/:id/dispatch`                                                     | A M E   | done   | APPROVED -> IN_TRANSIT; stock leaves the source (all items or none).                                    |
| PUT             | `/transfers/:id/receive`                                                      | A M E   | done   | IN_TRANSIT -> RECEIVED; stock arrives at the destination.                                               |
| PUT             | `/transfers/:id/cancel`                                                       | A M E   | done   | Only before dispatch. Employees: only their own requests.                                               |
| GET             | `/notifications`                                                              | any     | done   | `unreadOnly`; `meta.unread` = unread count                                                              |
| PUT             | `/notifications/:id/read`                                                     | any     | done   |                                                                                                         |
| PUT             | `/notifications/read-all`                                                     | any     | done   |                                                                                                         |
| GET             | `/dashboard`                                                                  | A M V   | done   | KPIs and chart data                                                                                     |
| GET             | `/analytics/{valuation,turnover,movement,fast-moving,slow-moving,dead-stock}` | A M V   | done   | `from, to, warehouseId, interval, limit, deadDays`                                                      |
| GET             | `/forecasts`                                                                  | A M     | done   | Latest forecast per product + recommendation; `urgency, categoryId`                                     |
| GET             | `/forecasts/:productId`                                                       | A M     | done   | History + forecast series, WAPE vs baseline WAPE, recommendation                                        |
| GET             | `/admin/audit-log`                                                            | A       | done   | `entity, userId, page, pageSize`                                                                        |
| GET             | `/admin/consistency-check`                                                    | A       | done   | `{ ok, checkedPairs, mismatches[] }`                                                                    |

Employees only see and change their own warehouse (checked in the services).

## Socket.IO events (server -> client)

Connect with `io(SOCKET_URL, { auth: { token: accessToken } })`. Invalid or deactivated
tokens are rejected. Rooms: `user:{id}`, `role:{ROLE}`, `warehouse:{id}`. Events are sent
only after the database transaction has committed.

| Event               | Payload                                                                                                        |
| ------------------- | -------------------------------------------------------------------------------------------------------------- |
| `inventory:updated` | `productId, warehouseId, previousQuantity, newQuantity, type, userName`                                        |
| `activity:new`      | `transactionId, productId, productName, warehouseId, warehouseName, type, quantityChange, userName, createdAt` |
| `transfer:updated`  | `transferId, status, fromWarehouseId, toWarehouseId`                                                           |
| `alert:low-stock`   | `productId, warehouseId, quantity, reorderLevel`                                                               |
| `notification:new`  | the Notification row                                                                                           |
| `dashboard:stale`   | none: refetch the dashboard                                                                                    |
