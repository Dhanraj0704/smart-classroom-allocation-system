# Roomwise classroom allocation

Frontend (`public/`) + zero-dependency Node backend (`server/`). Needs Node 18+; no `npm install`.

```
node server/server.js        # or: npm start   (PORT=8080 to change port)
# open http://localhost:3000
node server/test.js          # API tests
```

Data is stored in `data/roomwise.json` (override with `DATA_FILE`). Back that file up to back up your data.
If a browser still holds data from the old localStorage version and the server is empty, it is uploaded automatically on first load.

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/state` | rooms, classes, last allocation |
| PUT | `/api/state` | bulk replace `{rooms, classes}` |
| GET/POST | `/api/rooms` | list / create room |
| PUT/DELETE | `/api/rooms/:id` | update / delete room |
| GET/POST | `/api/classes` | list / create class |
| PUT/DELETE | `/api/classes/:id` | update / delete class |
| POST | `/api/allocation` | run the optimizer, save and return the plan |
| GET | `/api/allocation` | last plan (`null` if stale) |

`POST /api/allocation` returns `{assignments: {classId: roomId}, reasons: {classId: why-unplaced}, placed, total, generatedAt}`.
Editing any room or class clears the saved plan. Errors are `{error: "message"}` with 400 (validation), 404, or 409 (duplicate room number in a block / duplicate class number).

## Allocation rules
A room is assigned only if it has enough seats, all required facilities, and is available at the class's slot; no room hosts two classes in one slot. The min-cost-flow allocator maximizes classes placed, then favors less wasted capacity and the preferred block.
