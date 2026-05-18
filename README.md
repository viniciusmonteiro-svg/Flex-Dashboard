# Marketing Dashboard

Local-first marketing spend analytics for Curve Dental / DentalHQ.
Runs entirely on your Windows machine — no cloud services, no authentication.

---

## Stack

- **Next.js 15** (App Router) — dashboard UI
- **TypeScript** — end to end
- **DuckDB** — local analytical database *(added in Phase 2)*
- **Source data** — files read directly from a Google Drive for Desktop synced folder

---

## Phase 1 Setup

### 1. Install Google Drive for Desktop

Download from [drive.google.com/drive/download](https://www.google.com/drive/download) and sign in with your Curve Dental account.

### 2. Add the shared folder shortcut

In [drive.google.com](https://drive.google.com), find the **Marketing Dashboard** shared folder, right-click → **Add shortcut to Drive** → place it anywhere in **My Drive**.

### 3. Make it available offline (recommended)

In File Explorer, right-click the synced folder → **Always keep on this device**.
This ensures files can be read instantly without waiting for Drive to download them.

### 4. Configure the source path

Create `.env.local` in the project root (it is gitignored):

```
SOURCE_DATA_PATH=G:\.shortcut-targets-by-id\1-IDOv8ALU7_Iuu2ernGj-KUz9re-s38v\FP&A\Vinicius - FP&A\Marketing Report\Marketing Dashboard
```

See `.env.example` for the template.

### 5. Verify Drive integration

```bash
npm run check-source
```

Expected output:
```
✓ Path resolved: G:\.shortcut-targets-by-id\...\Marketing Dashboard
✓ Folder is readable
✓ N entries found — X file(s), Y subfolder(s)
```

If it fails, the error message will tell you exactly what to fix.

---

## Development

```bash
npm run dev        # Start Next.js dev server (http://localhost:3000)
npm run build      # Production build
npm run check-source  # Verify Drive folder is accessible
```

---

## Project Structure

```
src/
  app/             # Next.js App Router pages
  config/
    source-path.ts # validateSourcePath() — single source of truth for Drive access
  lib/
    env.ts         # Typed environment variable accessors
scripts/
  check-source.ts  # CLI: npm run check-source
.env.local         # Your local config (gitignored)
.env.example       # Template — safe to commit
```

---

## Constraints

- **No Drive API** — source data is read as plain local files via `fs`.
  No `googleapis`, no OAuth, no service accounts.
- **Read-only source** — the app never writes to the Drive-synced folder.
- **Manual refresh** — data ingestion is triggered explicitly, never on a schedule.
- **All path operations use Node's `path` module** — no string concatenation.
