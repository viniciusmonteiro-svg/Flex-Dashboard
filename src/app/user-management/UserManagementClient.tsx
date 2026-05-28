'use client';

import { useEffect, useState } from 'react';

interface PreApprovedEntry {
  id: string;
  email: string;
  role: string;
  note: string | null;
  created_at: string;
  claimed_at: string | null;
}

interface PendingRequest {
  id: string;
  clerk_id: string;
  email: string;
  name: string;
  requested_at: string;
}

interface ActiveUser {
  id: string;
  clerk_id: string;
  email: string;
  name: string;
  role: string;
  created_at: string;
}

export default function UserManagementClient() {
  const [entries,  setEntries]  = useState<PreApprovedEntry[]>([]);
  const [pending,  setPending]  = useState<PendingRequest[]>([]);
  const [users,    setUsers]    = useState<ActiveUser[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [error,    setError]    = useState<string | null>(null);

  // Add pre-approved form state
  const [addEmail, setAddEmail] = useState('');
  const [addRole,  setAddRole]  = useState('viewer');
  const [addNote,  setAddNote]  = useState('');
  const [adding,   setAdding]   = useState(false);

  // Role edit state: clerk_id → selected role
  const [roleEdits, setRoleEdits] = useState<Record<string, string>>({});

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [entriesRes, pendingRes, usersRes] = await Promise.all([
        fetch('/api/admin/pre-approved'),
        fetch('/api/admin/approve-user'),
        fetch('/api/admin/users'),
      ]);
      const [e, p, u] = await Promise.all([
        entriesRes.json(),
        pendingRes.json(),
        usersRes.json(),
      ]);
      if (e.ok) setEntries(e.entries ?? []);
      if (p.ok) setPending(p.requests ?? []);
      if (u.ok) setUsers(u.users ?? []);
    } catch {
      setError('Failed to load data.');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  async function handleAddPreApproved(e: React.FormEvent) {
    e.preventDefault();
    if (!addEmail) return;
    setAdding(true);
    try {
      const res  = await fetch('/api/admin/pre-approved', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email: addEmail, role: addRole, note: addNote || null }),
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error);
      setAddEmail(''); setAddNote(''); setAddRole('viewer');
      await load();
    } catch (err) {
      alert((err as Error).message);
    } finally {
      setAdding(false);
    }
  }

  async function handleRemoveEntry(id: string) {
    if (!confirm('Remove this pre-approved email?')) return;
    await fetch('/api/admin/pre-approved', {
      method:  'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ id }),
    });
    await load();
  }

  async function handleApprove(clerk_id: string) {
    const role = roleEdits[clerk_id] ?? 'viewer';
    await fetch('/api/admin/approve-user', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clerk_id, role, action: 'approve' }),
    });
    await load();
  }

  async function handleDeny(clerk_id: string) {
    if (!confirm('Deny this user?')) return;
    await fetch('/api/admin/approve-user', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clerk_id, action: 'deny' }),
    });
    await load();
  }

  async function handleSaveRole(clerk_id: string) {
    const role = roleEdits[clerk_id];
    if (!role) return;
    await fetch('/api/admin/change-role', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clerk_id, role }),
    });
    await load();
  }

  async function handleRemoveUser(clerk_id: string) {
    if (!confirm('Remove this user? This cannot be undone.')) return;
    await fetch('/api/admin/delete-user', {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body:    JSON.stringify({ clerk_id }),
    });
    await load();
  }

  const th = 'px-4 py-3 text-left text-xs font-bold uppercase tracking-wide text-white';
  const td = 'px-4 py-3 text-sm text-gray-700';

  return (
    <div className="space-y-10">
      <h1 className="text-xl font-bold text-gray-900">User Management</h1>

      {error && (
        <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </div>
      )}

      {/* ── Add Pre-Approved Email ─────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          Add Pre-Approved Email
        </h2>
        <form onSubmit={handleAddPreApproved} className="flex flex-wrap gap-2 items-end">
          <input
            type="email"
            required
            placeholder="email@curvedental.com"
            value={addEmail}
            onChange={(e) => setAddEmail(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm w-64 focus:outline-none focus:ring-2 focus:ring-[var(--color-primary)]"
          />
          <select
            value={addRole}
            onChange={(e) => setAddRole(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm focus:outline-none"
          >
            <option value="viewer">Viewer</option>
            <option value="admin">Admin</option>
          </select>
          <input
            type="text"
            placeholder="Note (optional)"
            value={addNote}
            onChange={(e) => setAddNote(e.target.value)}
            className="rounded-md border border-gray-300 px-3 py-2 text-sm w-48 focus:outline-none"
          />
          <button
            type="submit"
            disabled={adding}
            className="rounded-md bg-[var(--color-primary)] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {adding ? 'Adding…' : 'Add'}
          </button>
        </form>
      </section>

      {/* ── Pending Access Requests ──────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">
          Pending Access Requests
          {pending.length > 0 && (
            <span className="ml-2 inline-flex items-center rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700">
              {pending.length}
            </span>
          )}
        </h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : pending.length === 0 ? (
          <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            No pending requests.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800">
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Requested</th>
                  <th className={th}>Role</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {pending.map((r) => (
                  <tr key={r.clerk_id} className="bg-white hover:bg-gray-50">
                    <td className={td}>{r.name || '—'}</td>
                    <td className={td}>{r.email}</td>
                    <td className={td}>{new Date(r.requested_at).toLocaleDateString()}</td>
                    <td className={td}>
                      <select
                        value={roleEdits[r.clerk_id] ?? 'viewer'}
                        onChange={(e) => setRoleEdits((prev) => ({ ...prev, [r.clerk_id]: e.target.value }))}
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className={td}>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleApprove(r.clerk_id)}
                          className="rounded bg-green-600 px-3 py-1 text-xs font-medium text-white hover:bg-green-700"
                        >
                          Approve
                        </button>
                        <button
                          onClick={() => handleDeny(r.clerk_id)}
                          className="rounded bg-red-500 px-3 py-1 text-xs font-medium text-white hover:bg-red-600"
                        >
                          Deny
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Active Users ──────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Active Users</h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : users.length === 0 ? (
          <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            No active users.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800">
                  <th className={th}>Name</th>
                  <th className={th}>Email</th>
                  <th className={th}>Role</th>
                  <th className={th}>Joined</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {users.map((u) => (
                  <tr key={u.clerk_id} className="bg-white hover:bg-gray-50">
                    <td className={td}>{u.name || '—'}</td>
                    <td className={td}>{u.email}</td>
                    <td className={td}>
                      <select
                        value={roleEdits[u.clerk_id] ?? u.role}
                        onChange={(e) => setRoleEdits((prev) => ({ ...prev, [u.clerk_id]: e.target.value }))}
                        className="rounded border border-gray-300 px-2 py-1 text-xs"
                      >
                        <option value="viewer">Viewer</option>
                        <option value="admin">Admin</option>
                      </select>
                    </td>
                    <td className={td}>{new Date(u.created_at).toLocaleDateString()}</td>
                    <td className={td}>
                      <div className="flex gap-2">
                        <button
                          onClick={() => handleSaveRole(u.clerk_id)}
                          disabled={!roleEdits[u.clerk_id] || roleEdits[u.clerk_id] === u.role}
                          className="rounded bg-[var(--color-primary)] px-3 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-40"
                        >
                          Save Role
                        </button>
                        <button
                          onClick={() => handleRemoveUser(u.clerk_id)}
                          className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                        >
                          Remove
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Allowlist ─────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <h2 className="text-sm font-bold uppercase tracking-wide text-gray-700">Allowlist</h2>
        {loading ? (
          <div className="text-sm text-gray-400">Loading…</div>
        ) : entries.length === 0 ? (
          <div className="rounded-lg border border-gray-200 px-4 py-8 text-center text-sm text-gray-400">
            No pre-approved emails.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border border-gray-200">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-800">
                  <th className={th}>Email</th>
                  <th className={th}>Role</th>
                  <th className={th}>Note</th>
                  <th className={th}>Status</th>
                  <th className={th}>Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {entries.map((e) => (
                  <tr key={e.id} className="bg-white hover:bg-gray-50">
                    <td className={td}>{e.email}</td>
                    <td className={td}>{e.role}</td>
                    <td className={td}>{e.note || '—'}</td>
                    <td className={td}>
                      {e.claimed_at ? (
                        <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs font-medium text-green-700">
                          Claimed
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-yellow-100 px-2 py-0.5 text-xs font-medium text-yellow-700">
                          Pending
                        </span>
                      )}
                    </td>
                    <td className={td}>
                      <button
                        onClick={() => handleRemoveEntry(e.id)}
                        className="rounded border border-red-300 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-50"
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
