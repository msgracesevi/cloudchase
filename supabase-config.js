// ════════════════════════════════════════════════════════
//  CLOUDCHASE — Supabase Config  (supabase-config.js)
//  Include this <script> BEFORE any cloudchase-*.js file.
//  Uses the Supabase CDN client (no build step required).
// ════════════════════════════════════════════════════════

// ── 🔑  FILL IN YOUR OWN VALUES ──────────────────────────
const SUPABASE_URL    = 'https://pluatebccsecvqsawbzz.supabase.co';
const SUPABASE_ANON   = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBsdWF0ZWJjY3NlY3Zxc2F3Ynp6Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk0MzY2NjMsImV4cCI6MjA5NTAxMjY2M30.w1PL-50NfqIyVsXmhvcD3gNkHZzQFX4ATqBvZybgV1c';
// ─────────────────────────────────────────────────────────

const { createClient } = window.supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON);