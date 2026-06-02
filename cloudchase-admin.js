// ════════════════════════════════════════════════════════
//  ROLE-BASED ACCESS CONTROL (RBAC)
//  Roles: owner > manager > staff
//  owner   → full access (all pages, all actions)
//  manager → manage products & inventory; view-only everything else
//  staff   → view-only (no writes, no deletes, no modals)
// ════════════════════════════════════════════════════════

// ════════════════════════════════════════════════════════
//  CREDENTIALS — verified against Supabase admin_roles table
//  Passwords are SHA-256 hashed before comparison.
// ════════════════════════════════════════════════════════

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyCredentials(role, username, password) {
  try {
    const inputHash = await hashPassword(password);
    const { data, error } = await db
      .from('admin_roles')
      .select('password_hash')
      .eq('role', role)
      .eq('username', username.trim().toLowerCase())
      .single();
    if (error || !data) return false;
    return data.password_hash === inputHash;
  } catch (e) {
    console.error('verifyCredentials error:', e);
    return false;
  }
}

const ROLE_META = {
  owner:   { label:'OWNER',   icon:'', avatar:'O', color:'var(--accent)' },
  manager: { label:'MANAGER', icon:'', avatar:'M', color:'var(--warn)'   },
  staff:   { label:'STAFF',   icon:'', avatar:'S', color:'var(--text3)'  },
};

// Permissions
const PERMISSIONS = {
  owner:   ['manage_all', 'manage_products', 'manage_stocks', 'view_all'],
  manager: ['manage_products', 'manage_stocks', 'view_all'],
  staff:   ['view_all'],
};

let CURRENT_ROLE = null;   // set after login

function can(permission) {
  if (!CURRENT_ROLE) return false;
  return PERMISSIONS[CURRENT_ROLE]?.includes(permission) ?? false;
}

// Call this before any write action. Runs fn() if allowed, shows toast if not.
function rbacAction(permission, fn) {
  if (can(permission)) { fn(); return; }
  const need = permission === 'manage_all' ? 'Owner' : 'Manager or Owner';
  showToast(`Access denied — ${need} role required`, 'err');
}

// ── APPLY RBAC TO THE UI ─────────────────────────────────
function applyRoleUI() {
  const role = CURRENT_ROLE;
  const meta = ROLE_META[role];

  // Update sidebar chip
  document.getElementById('sidebar-avatar').textContent = meta.avatar;
  document.getElementById('sidebar-name').textContent   = role === 'owner' ? 'Admin' : meta.label.charAt(0) + meta.label.slice(1).toLowerCase();
  document.getElementById('sidebar-role').textContent   = meta.label;
  document.getElementById('sidebar-role').style.color   = meta.color;

  // Update topbar greeting
  const subEl = document.getElementById('topbar-sub');
  if (subEl) subEl.textContent = `Logged in as ${meta.label}`;

  // Show/hide action buttons based on role
  const ownerOnlyIds  = ['btn-add-rider', 'btn-add-promo', 'promo-add-card'];
  const managerUpIds  = ['btn-add-product'];

  ownerOnlyIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = can('manage_all') ? '' : 'none';
  });
  managerUpIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.style.display = can('manage_products') ? '' : 'none';
  });

  // Role banner — place it as first child of #main (above sync bar + topbar)
  // Actually we want it INSIDE #main, right after #topbar, before pages
  let banner = document.getElementById('role-access-bar');
  if (!banner) {
    banner = document.createElement('div');
    banner.id = 'role-access-bar';
    // Insert after sync-status-bar inside #main
    const syncBar = document.getElementById('sync-status-bar');
    if (syncBar && syncBar.parentNode) {
      syncBar.parentNode.insertBefore(banner, syncBar.nextSibling);
    } else {
      const mainEl = document.getElementById('main');
      if (mainEl) mainEl.prepend(banner);
    }
  }

  if (role === 'staff') {
    banner.innerHTML = `<strong>VIEW ONLY MODE</strong> — Staff cannot make changes`;
    banner.className = 'staff';
  } else if (role === 'manager') {
    banner.innerHTML = `<strong>MANAGER MODE</strong> — Can manage Products & Inventory`;
    banner.className = 'manager';
  } else {
    banner.innerHTML = `<strong>OWNER MODE</strong> — Full access enabled`;
    banner.className = 'owner';
  }
}

// ── LOGIN SCREEN ─────────────────────────────────────────
let loginSelectedRole = null;

function selectLoginRole(role, el) {
  loginSelectedRole = role;
  document.querySelectorAll('.login-box .role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('login-creds-section').classList.add('visible');
  document.getElementById('login-pin-label').textContent = `Sign in as ${ROLE_META[role].label}`;
  document.getElementById('login-pin-hint').textContent = '';
  // Reset fields
  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');
  if (u) { u.value = ''; u.focus(); }
  if (p) p.value = '';
}

function toggleLoginPwd() {
  const inp = document.getElementById('login-password');
  const btn = document.getElementById('login-pwd-toggle');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? 'HIDE' : 'SHOW';
}

async function loginSubmit() {
  const hintEl = document.getElementById('login-pin-hint');
  if (!loginSelectedRole) { hintEl.textContent = 'Please select a role first.'; return; }
  const username = (document.getElementById('login-username')?.value || '').trim();
  const password = document.getElementById('login-password')?.value || '';
  if (!username) { hintEl.textContent = 'Please enter your username.'; return; }
  if (!password) { hintEl.textContent = 'Please enter your password.'; return; }

  const btn = document.querySelector('.login-creds-section .login-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  const ok = await verifyCredentials(loginSelectedRole, username, password);

  if (btn) { btn.disabled = false; btn.textContent = 'LOGIN ↵'; }

  if (ok) {
    CURRENT_ROLE = loginSelectedRole;
    sessionStorage.setItem('cc_role', loginSelectedRole);
    sessionStorage.setItem('cc_username', username);
    document.body.classList.add('rbac-ready');
    document.getElementById('login-screen').classList.add('hidden');
    applyRoleUI();
    initAdmin();
  } else {
    hintEl.textContent = 'Incorrect username or password. Try again.';
    document.getElementById('login-password').value = '';
    document.getElementById('login-password').focus();
  }
}

// ── ROLE SWITCHER MODAL ──────────────────────────────────
let switchSelectedRole = null;

function openRoleSwitchModal() {
  switchSelectedRole = null;
  document.querySelectorAll('#role-switch-modal .role-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('switch-pin-hint').textContent = '';
  const u = document.getElementById('switch-username');
  const p = document.getElementById('switch-password');
  if (u) u.value = '';
  if (p) p.value = '';
  document.getElementById('role-switch-modal').classList.add('open');
}

function closeRoleSwitchModal() {
  document.getElementById('role-switch-modal').classList.remove('open');
}

function selectSwitchRole(role, el) {
  switchSelectedRole = role;
  document.querySelectorAll('#role-switch-modal .role-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  document.getElementById('switch-pin-hint').textContent = '';
  const u = document.getElementById('switch-username');
  if (u) { u.value = ''; u.focus(); }
  const p = document.getElementById('switch-password');
  if (p) p.value = '';
}

function toggleSwitchPwd() {
  const inp = document.getElementById('switch-password');
  const btn = document.getElementById('switch-pwd-toggle');
  if (!inp) return;
  const show = inp.type === 'password';
  inp.type = show ? 'text' : 'password';
  btn.textContent = show ? 'HIDE' : 'SHOW';
}

async function switchCredsSubmit() {
  const hintEl = document.getElementById('switch-pin-hint');
  if (!switchSelectedRole) { hintEl.textContent = 'Please select a role.'; return; }
  const username = (document.getElementById('switch-username')?.value || '').trim();
  const password = document.getElementById('switch-password')?.value || '';
  if (!username) { hintEl.textContent = 'Please enter your username.'; return; }
  if (!password) { hintEl.textContent = 'Please enter your password.'; return; }

  const btn = document.querySelector('#switch-creds-section .login-submit-btn');
  if (btn) { btn.disabled = true; btn.textContent = 'Verifying…'; }

  const ok = await verifyCredentials(switchSelectedRole, username, password);

  if (btn) { btn.disabled = false; btn.textContent = 'SWITCH ROLE ↵'; }

  if (ok) {
    CURRENT_ROLE = switchSelectedRole;
    sessionStorage.setItem('cc_role', switchSelectedRole);
    sessionStorage.setItem('cc_username', document.getElementById('switch-username')?.value?.trim() || ''  );
    closeRoleSwitchModal();
    applyRoleUI();
    showToast(`Switched to ${ROLE_META[CURRENT_ROLE].label} role`, '');
  } else {
    hintEl.textContent = 'Wrong username or password. Try again.';
    document.getElementById('switch-password').value = '';
    document.getElementById('switch-password').focus();
  }
}

// ════════════════════════════════════════════════════════
//  CLOUDCHASE ADMIN — Supabase Edition (no hardcoded data)
//  Requires: supabase-config.js loaded first
//  All orders, products, inventory, riders, promos → Supabase
// ════════════════════════════════════════════════════════


// ── LIVE STATE ──
let ORDERS            = [];
let filteredOrders    = [];
let PRODUCTS          = [];
let lastOrderCount    = 0;
let currentInvProduct = null;   // index into PRODUCTS

// ── map Supabase orders row → admin display shape ──
function dbOrderToAdmin(row) {
  const shipping = row.shipping || {};
  const fullName = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || row.user_email || 'Customer';
  return {
    id:              row.id,
    customer:        fullName,
    email:           shipping.email || row.user_email || '',
    phone:           shipping.phone || '',
    address:         [shipping.address, shipping.city].filter(Boolean).join(', ') || '',
    date:            row.date ? new Date(row.date).toLocaleString('en-PH',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '',
    items:           (row.items || []).map(it => ({ name: it.name||'Item', qty: it.qty||1, price: it.price||0 })),
    total:           row.total || 0,
    payment:         (row.payment || 'cod').toUpperCase(),
    status:          row.status || 'processing',
    userEmail:       row.user_email || '',
    riderId:         row.rider_id    || null,
    riderName:       row.rider_name  || null,
    riderPhone:      row.rider_phone || null,
    riderPlate:      row.rider_plate || null,
    riderAcceptedAt: row.rider_accepted_at || null,
    riderStep:       row.rider_step  || null,
    deliveredAt:     row.delivered_at || null,
    _fromShop:       true,
  };
}

// ── map Supabase products row → local shape ──
function dbProductToAdmin(row) {
  return {
    _dbId:     row.id,
    emoji:     row.emoji     || '',
    name:      row.name      || 'Unnamed Product',
    sku:       row.sku       || '',
    cat:       row.category  || row.cat || '',
    price:     row.price     || 0,
    stock:     row.stock     ?? 0,
    image_url: row.image_url || null,
  };
}

// ── IMAGE UPLOAD ──
let pendingImageFile = null;

function handleImageSelect(input) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 2 * 1024 * 1024) { showToast('Image must be under 2MB', 'err'); return; }
  pendingImageFile = file;

  const reader = new FileReader();
  reader.onload = e => {
    const preview = document.getElementById('img-upload-preview');
    const area    = document.getElementById('img-upload-area');
    preview.innerHTML = `
      <img src="${e.target.result}" alt="Preview">
      <div class="img-upload-overlay">
        <button class="img-upload-change" onclick="event.stopPropagation();document.getElementById('p-image-file').click()">Change</button>
        <button class="img-upload-remove" onclick="event.stopPropagation();clearImageUpload()">Remove</button>
      </div>`;
    area.classList.add('has-image');
  };
  reader.readAsDataURL(file);
}

function clearImageUpload() {
  pendingImageFile = null;
  document.getElementById('p-image-url').value   = '';
  document.getElementById('p-image-file').value  = '';
  const area    = document.getElementById('img-upload-area');
  const preview = document.getElementById('img-upload-preview');
  area.classList.remove('has-image');
  preview.innerHTML = `
    <div class="img-upload-icon"></div>
    <div class="img-upload-text">Click to upload image</div>
    <div class="img-upload-sub">PNG, JPG, WEBP · Max 2MB</div>`;
}

async function uploadProductImage(file, productName) {
  const ext      = file.name.split('.').pop();
  const safeName = productName.toLowerCase().replace(/[^a-z0-9]/g, '-').slice(0, 40);
  const path     = `products/${safeName}-${Date.now()}.${ext}`;

  const { data, error } = await db.storage.from('product-images').upload(path, file, {
    contentType: file.type,
    upsert: false,
  });

  if (error) {
    console.error('Image upload failed:', error);
    showToast('Image upload failed: ' + (error.message || 'Storage error'), 'err');
    return null;
  }

  const { data: { publicUrl } } = db.storage.from('product-images').getPublicUrl(path);
  return publicUrl;
}

// ══════════════════════════════════════════════════════════
//  LOAD DATA FROM SUPABASE
// ══════════════════════════════════════════════════════════
async function loadOrders() {
  const { data, error } = await db.from('orders').select('*').order('date', { ascending: false });
  if (error) { console.error('loadOrders:', error); return; }

  const liveOrders = (data || []).map(dbOrderToAdmin);

  if (liveOrders.length > lastOrderCount && lastOrderCount > 0) {
    flashNewOrderBanner(liveOrders.length - lastOrderCount);
  }
  lastOrderCount = liveOrders.length;

  ORDERS         = liveOrders;
  filteredOrders = [...ORDERS];
}

async function loadProducts() {
  const { data, error } = await db.from('products').select('*').order('id', { ascending: true });
  if (error) { console.error('loadProducts:', error); return; }
  PRODUCTS = (data || []).map(dbProductToAdmin);
}

// ── STATUS UPDATE → Supabase ──
async function saveOrderStatusToSupabase(orderId, newStatus, extra = {}) {
  const update = { status: newStatus };
  if (extra.riderName)       update.rider_name        = extra.riderName;
  if (extra.riderPhone)      update.rider_phone       = extra.riderPhone;
  if (extra.riderPlate)      update.rider_plate       = extra.riderPlate;
  if (extra.riderId)         update.rider_id          = extra.riderId;
  if (extra.riderAcceptedAt) update.rider_accepted_at = extra.riderAcceptedAt;
  if (extra.riderStep)       update.rider_step        = extra.riderStep;
  if (extra.deliveredAt)     update.delivered_at      = extra.deliveredAt;
  const { error } = await db.from('orders').update(update).eq('id', orderId);
  if (error) console.error('saveOrderStatus:', error);
}

// ── RIDER REGISTRY ──
async function getRiders() {
  const { data } = await db.from('riders').select('*').order('last_seen', { ascending: false });
  return data || [];
}

// ══════════════════════════════════════════════════════════
//  REAL-TIME SUBSCRIPTIONS
// ══════════════════════════════════════════════════════════
function startRealtimeSync() {
  db.channel('admin-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
      await loadOrders();
      refreshAllViews();
      updateBadges();
      renderSyncStatus();
    })
    .subscribe();

  db.channel('admin-riders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'riders' }, async () => {
      updateBadges();
      renderSyncStatus();
      const riderPage = document.getElementById('page-riders');
      if (riderPage && riderPage.classList.contains('active')) renderRiders();
    })
    .subscribe();

  db.channel('admin-products')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
      await loadProducts();
      renderProducts();
      renderInventory();
      updateBadges();
    })
    .subscribe();

  db.channel('admin-reviews')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'reviews' }, async () => {
      await loadReviews();
      renderReviewSummary();
      updateBadges();
      const reviewPage = document.getElementById('page-reviews');
      if (reviewPage && reviewPage.classList.contains('active')) renderReviews();
    })
    .subscribe();
}

function refreshAllViews() {
  renderDashOrders();
  renderOrders(filteredOrders);
  renderCustomersFromOrders();
  renderRevChart();
  renderDashboardStats();
}

// ── NEW ORDER FLASH ──
function flashNewOrderBanner(count) {
  const existing = document.getElementById('new-order-banner');
  if (existing) existing.remove();
  const banner = document.createElement('div');
  banner.id = 'new-order-banner';
  banner.innerHTML = `
    <span><strong>${count} new order${count > 1 ? 's' : ''} received!</strong> A customer just placed an order from the shop.</span>
    <button onclick="showPage('orders',document.getElementById('nav-orders'));this.parentElement.remove()">View Orders →</button>
    <button class="close-banner" onclick="this.parentElement.remove()">✕</button>
  `;
  document.getElementById('main').prepend(banner);
  setTimeout(() => { if (banner.parentElement) banner.remove(); }, 8000);
}

// ══════════════════════════════════════════════════════════
//  NAVIGATION
// ══════════════════════════════════════════════════════════
function showPage(id, el) {
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.getElementById('page-' + id).classList.add('active');
  if (el) el.classList.add('active');
  const titles = { dashboard:'DASHBOARD', orders:'ORDERS', products:'PRODUCTS', inventory:'INVENTORY', customers:'CUSTOMERS', promotions:'PROMOTIONS', reports:'REPORTS', payments:'PAYMENTS', settings:'SETTINGS', riders:'RIDERS', reviews:'REVIEWS' };
  const subs   = { dashboard:'Welcome back, Admin', orders:'Manage and process customer orders', products:'Manage your product catalog', inventory:'Track stock levels', customers:'View customer profiles', promotions:'Manage promo codes', reports:'Sales analytics', payments:'Manage payment methods', settings:'Store configuration', riders:'Live rider tracking & dispatch', reviews:'Customer product reviews & ratings' };
  document.getElementById('topbar-title').textContent = titles[id] || id.toUpperCase();
  document.getElementById('topbar-sub').textContent   = subs[id]   || '';
  if (id === 'riders')     renderRiders();
  if (id === 'promotions') renderPromos();
  if (id === 'reviews')    renderReviews();
  if (id === 'reports')    renderReports();
  if (id === 'payments')   renderPaymentSettings();
}

// ── BADGES ──
async function updateBadges() {
  const pending  = ORDERS.filter(x => x.status === 'pending' || x.status === 'processing').length;
  document.getElementById('pending-badge').textContent = pending;
  document.getElementById('dash-pending').textContent  = pending;

  const lowCount = PRODUCTS.filter(x => x.stock > 0 && x.stock < 5).length;
  const outCount = PRODUCTS.filter(x => x.stock === 0).length;
  document.getElementById('lowstock-badge').textContent = lowCount + outCount;

  const { data: riderData } = await db.from('riders').select('online').eq('online', true);
  const onlineRiders = (riderData || []).length;
  const rb = document.getElementById('riders-badge');
  if (rb) { rb.textContent = onlineRiders; rb.style.display = onlineRiders ? '' : 'none'; }
}

// ── SYNC STATUS BAR ──
async function renderSyncStatus() {
  const bar = document.getElementById('sync-status-bar');
  if (!bar) return;
  const liveCount = ORDERS.filter(o => o._fromShop).length;
  const { data: riderData } = await db.from('riders').select('online').eq('online', true);
  const onlineRiders = (riderData || []).length;
  bar.innerHTML = `<span class="sync-dot"></span> LIVE SYNC ON &nbsp;·&nbsp; ${liveCount} live order${liveCount !== 1 ? 's' : ''} &nbsp;·&nbsp; ${onlineRiders} rider${onlineRiders !== 1 ? 's' : ''} online`;
}

// ══════════════════════════════════════════════════════════
//  RENDER: DASHBOARD
// ══════════════════════════════════════════════════════════
function renderDashOrders() {
  const tbody = document.getElementById('dash-orders-tbody');
  tbody.innerHTML = ORDERS.slice(0, 5).map(o => `
    <tr class="${o._fromShop ? 'live-order-row' : ''}">
      <td><span class="order-link" onclick="openOrder('${o.id}')">${o.id}</span>${o._fromShop ? ' <span class="live-tag">LIVE</span>' : ''}</td>
      <td>${o.customer}</td>
      <td class="text-mono text-bold">₱${o.total.toLocaleString()}</td>
      <td>${badgeHTML(o.status)}</td>
    </tr>`).join('') || `<tr><td colspan="4"><div class="empty-state"><p>No orders yet</p></div></td></tr>`;
}

// ══════════════════════════════════════════════════════════
//  RENDER: ORDERS TABLE
// ══════════════════════════════════════════════════════════
function renderOrders(list) {
  const tbody = document.getElementById('orders-tbody');
  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="9"><div class="empty-state"><p>No orders found</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = list.map(o => {
    const riderInfo = o.riderName
      ? `<span class="rider-pill">${o.riderName}</span>`
      : (o.status !== 'delivered' && o.status !== 'cancelled' && o.status !== 'pending'
          ? `<span class="rider-pill unassigned">No rider</span>` : '');
    return `
    <tr class="${o._fromShop ? 'live-order-row' : ''}">
      <td><span class="order-link" onclick="openOrder('${o.id}')">${o.id}</span>${o._fromShop ? ' <span class="live-tag">LIVE</span>' : ''}</td>
      <td>${o.customer}</td>
      <td class="text-xs-muted text-mono">${o.date}</td>
      <td class="text-sm">${o.items.length} item${o.items.length > 1 ? 's' : ''}</td>
      <td class="text-mono text-bolder">₱${o.total.toLocaleString()}</td>
      <td><span class="text-sm-muted">${o.payment}</span></td>
      <td>${badgeHTML(o.status)}</td>
      <td>${riderInfo}</td>
      <td>
        <div class="product-actions">
          ${o.status === 'pending'
            ? `<button class="btn btn-primary btn-xs" onclick="updateStatus('${o.id}','processing')">Confirm</button>`
            : ''}
          ${(o.status === 'pending' || o.status === 'processing')
            ? `<button class="btn btn-danger btn-xs" onclick="updateStatus('${o.id}','cancelled')">Cancel</button>`
            : ''}
          ${(o.status === 'out_for_delivery' || o.status === 'shipped' || o.status === 'delivered')
            ? `<span class="text-xs-muted" style="font-family:var(--mono);font-size:11px">Rider-controlled</span>`
            : ''}
          ${o.status === 'cancelled'
            ? `<span class="text-xs-muted" style="font-family:var(--mono);font-size:11px">Closed</span>`
            : ''}
        </div>
      </td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  RENDER: RIDERS PAGE
// ══════════════════════════════════════════════════════════
async function renderRiders() {
  const riders = await getRiders();
  const tbody  = document.getElementById('riders-tbody');
  if (!tbody) return;

  if (!riders.length) {
    tbody.innerHTML = `<tr><td colspan="7"><div class="empty-state"><p>No riders yet. Add your first rider using the button above.</p></div></td></tr>`;
    renderRiderStats(riders);
    return;
  }

  tbody.innerHTML = riders.map(r => {
    const lastSeen  = r.last_seen ? new Date(r.last_seen).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'}) : '—';
    const order     = r.current_order_id ? ORDERS.find(o => o.id === r.current_order_id) : null;
    const orderInfo = order
      ? `<span class="order-link" onclick="openOrder('${order.id}')">#${order.id}</span> — ${(order.customer||'').split(' ')[0]}`
      : '—';
    const stepLabel = order ? formatRiderStep(order.riderStep, order.status) : '—';
    const statusDot = r.online
      ? `<span class="rider-status-dot online"></span> Online`
      : `<span class="rider-status-dot offline"></span> Offline`;
    return `
    <tr>
      <td>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="rider-avatar-sm">${r.name.split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase()}</div>
          <div>
            <div style="font-weight:600;font-size:14px">${r.name}</div>
            <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${r.plate}</div>
          </div>
        </div>
      </td>
      <td class="text-sm text-mono">${r.phone}</td>
      <td>${statusDot}</td>
      <td>${orderInfo}</td>
      <td><span class="text-sm-muted">${stepLabel}</span></td>
      <td class="text-xs-muted text-mono">${lastSeen}</td>
      <td>
        <div class="product-actions">
          <button class="btn btn-ghost btn-xs" onclick="openEditRider('${r.id}')">Edit</button>
          <button class="btn btn-danger btn-xs" onclick="deleteRider('${r.id}','${r.name.replace(/'/g,"\\'")}')">Del</button>
        </div>
      </td>
    </tr>`;
  }).join('');

  renderRiderStats(riders);
}

function formatRiderStep(step, status) {
  if (status === 'delivered') return 'Delivered';
  const map = { 'accepted':'Accepted', 'picked_up':'Picked Up', 'on_the_way':'On the Way', 'delivered':'Delivered' };
  return map[step] || (status === 'out_for_delivery' ? 'Accepted' : '—');
}

function renderRiderStats(riders) {
  const online = riders.filter(r => r.online).length;
  const busy   = riders.filter(r => r.online && r.current_order_id).length;
  const idle   = riders.filter(r => r.online && !r.current_order_id).length;
  const el     = document.getElementById('rider-stats-row');
  if (!el) return;
  el.innerHTML = `
    <div class="mini-stat"><div class="val accent">${online}</div><div class="lbl">Online Riders</div></div>
    <div class="mini-stat"><div class="val warn">${busy}</div><div class="lbl">On Delivery</div></div>
    <div class="mini-stat"><div class="val">${idle}</div><div class="lbl">Available</div></div>
    <div class="mini-stat"><div class="val">${riders.length - online}</div><div class="lbl">Offline</div></div>
  `;
}

// ══════════════════════════════════════════════════════════
//  RIDER CRUD — Add / Edit / Delete
// ══════════════════════════════════════════════════════════
let riderEditId = null;

function openAddRider() {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  riderEditId = null;
  document.getElementById('rider-modal-title').textContent    = 'Add New Rider';
  document.getElementById('rider-modal-subtitle').textContent = 'Riders log in using their phone number and PIN.';
  document.getElementById('rider-modal-submit').textContent   = 'Add Rider';
  document.getElementById('r-pin-hint').textContent           = '';
  ['r-name','r-phone','r-plate','r-pin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  document.getElementById('rider-modal').classList.add('open');
}

async function openEditRider(id) {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  const { data, error } = await db.from('riders').select('*').eq('id', id).single();
  if (error || !data) { showToast('Could not load rider', 'err'); return; }

  riderEditId = id;
  document.getElementById('rider-modal-title').textContent    = 'Edit Rider';
  document.getElementById('rider-modal-subtitle').textContent = 'Update details or change PIN.';
  document.getElementById('rider-modal-submit').textContent   = 'Save Changes';
  document.getElementById('r-pin-hint').textContent           = 'Leave blank to keep current';

  document.getElementById('r-name').value  = data.name  || '';
  document.getElementById('r-phone').value = data.phone || '';
  document.getElementById('r-plate').value = data.plate || '';
  document.getElementById('r-pin').value   = '';
  document.getElementById('rider-modal').classList.add('open');
}

function closeRiderModal() {
  document.getElementById('rider-modal').classList.remove('open');
  riderEditId = null;
}

function toggleRiderPwd() {
  const input  = document.getElementById('r-pin');
  const toggle = document.getElementById('r-pwd-toggle');
  if (input.type === 'password') { input.type = 'text';     toggle.textContent = 'HIDE'; }
  else                           { input.type = 'password'; toggle.textContent = 'SHOW'; }
}

async function saveRider() {
  const name  = document.getElementById('r-name').value.trim();
  const phone = document.getElementById('r-phone').value.trim();
  const plate = document.getElementById('r-plate').value.trim().toUpperCase();
  const pin   = document.getElementById('r-pin').value.trim();

  if (!name)  { showToast('Full name is required', 'err'); return; }
  if (!phone) { showToast('Phone number is required', 'err'); return; }
  if (!plate) { showToast('Plate number is required', 'err'); return; }
  if (!riderEditId && !pin) { showToast('PIN is required for new riders', 'err'); return; }
  if (pin && (pin.length !== 4 || !/^\d{4}$/.test(pin))) { showToast('PIN must be exactly 4 digits', 'err'); return; }

  const submitBtn = document.getElementById('rider-modal-submit');
  submitBtn.disabled = true;
  submitBtn.textContent = 'Saving...';

  if (riderEditId) {
    const update = { name, phone, plate };
    if (pin) update.pin = pin;
    const { error } = await db.from('riders').update(update).eq('id', riderEditId);
    if (error) {
      showToast('Failed to update rider: ' + (error.message || 'Unknown error'), 'err');
      console.error(error);
    } else {
      showToast(`${name} updated!`);
      closeRiderModal();
      renderRiders();
    }
  } else {
    const { error } = await db.from('riders').insert({ name, phone, plate, pin, online: false });
    if (error) {
      showToast('Failed to add rider: ' + (error.message || 'Unknown error'), 'err');
      console.error(error);
    } else {
      showToast(`Rider "${name}" added!`);
      closeRiderModal();
      renderRiders();
      updateBadges();
    }
  }

  submitBtn.disabled = false;
  submitBtn.textContent = riderEditId ? 'Save Changes' : 'Add Rider';
}

async function deleteRider(id, name) {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  if (!confirm(`Remove rider "${name}"? This cannot be undone.`)) return;
  const { error } = await db.from('riders').delete().eq('id', id);
  if (error) { showToast('Failed to remove rider', 'err'); console.error(error); return; }
  showToast(`Rider "${name}" removed`);
  renderRiders();
  updateBadges();
}

// ══════════════════════════════════════════════════════════
//  RENDER: PRODUCTS
// ══════════════════════════════════════════════════════════
function renderProducts(list) {
  const tbody = document.getElementById('products-tbody');
  if (!PRODUCTS.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No products yet. Add your first product.</p></div></td></tr>`;
    return;
  }
  const rows = list !== undefined ? list : PRODUCTS;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No products match your filters.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((p) => {
    const i = PRODUCTS.indexOf(p);
    const thumbContent = p.image_url
      ? `<img src="${p.image_url}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">`
      : p.emoji;
    return `
    <tr>
      <td><div class="product-thumb"><div class="thumb-img">${thumbContent}</div><div><div class="thumb-name">${p.name}</div><div class="thumb-sku">${p.sku}</div></div></div></td>
      <td><span class="text-sm-muted">${p.cat}</span></td>
      <td class="text-mono text-bold">₱${p.price.toLocaleString()}</td>
      <td class="text-mono">${p.stock}</td>
      <td>${p.stock===0?'<span class="badge out">Out of Stock</span>':p.stock<5?'<span class="badge low-stock">Low Stock</span>':'<span class="badge in-stock">In Stock</span>'}</td>
      <td><div class="product-actions">
        <button class="btn btn-ghost btn-xs" onclick="openEditProduct(${i})">Edit</button>
        <button class="btn btn-danger btn-xs" onclick="deleteProduct(${i})">Del</button>
      </div></td>
    </tr>`;
  }).join('');
}

function filterProducts() {
  const q   = (document.getElementById('product-search')?.value || '').toLowerCase();
  const cat = document.getElementById('product-cat-filter')?.value || 'all';
  let list = [...PRODUCTS];
  if (q)           list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.cat||'').toLowerCase().includes(q));
  if (cat !== 'all') list = list.filter(p => (p.cat||'') === cat);
  renderProducts(list);
}

// ══════════════════════════════════════════════════════════
//  RENDER: INVENTORY
// ══════════════════════════════════════════════════════════
function renderInventory(list) {
  const tbody = document.getElementById('inventory-tbody');
  if (!PRODUCTS.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No products to track.</p></div></td></tr>`;
    return;
  }

  // Always update mini-stats from full PRODUCTS list
  const totalEl = document.getElementById('inv-stat-total');
  const lowEl   = document.getElementById('inv-stat-low');
  const outEl   = document.getElementById('inv-stat-out');
  if (totalEl) totalEl.textContent = PRODUCTS.length;
  if (lowEl)   lowEl.textContent   = PRODUCTS.filter(p => p.stock > 0 && p.stock < 5).length;
  if (outEl)   outEl.textContent   = PRODUCTS.filter(p => p.stock === 0).length;

  const rows = list !== undefined ? list : PRODUCTS;
  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="6"><div class="empty-state"><p>No products match your filters.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map((p) => {
    const i = PRODUCTS.indexOf(p);
    return `
    <tr>
      <td><div class="product-thumb"><div class="thumb-img">${p.emoji}</div><div class="thumb-name">${p.name}</div></div></td>
      <td><span class="text-mono-xs">${p.sku}</span></td>
      <td><span class="text-sm-muted">${p.cat}</span></td>
      <td class="text-mono text-bolder">${p.stock}</td>
      <td>${p.stock===0?'<span class="badge out">Out</span>':p.stock<5?'<span class="badge low-stock">Low</span>':'<span class="badge in-stock">OK</span>'}</td>
      <td><button class="btn btn-ghost btn-xs" onclick="openInvAdjust(${i})">Adjust</button></td>
    </tr>`;
  }).join('');
}

function filterInventory() {
  const q      = (document.getElementById('inventory-search')?.value || '').toLowerCase();
  const level  = document.getElementById('inventory-stock-filter')?.value || 'all';
  let list = [...PRODUCTS];
  if (q) list = list.filter(p => p.name.toLowerCase().includes(q) || (p.sku||'').toLowerCase().includes(q) || (p.cat||'').toLowerCase().includes(q));
  if (level === 'out') list = list.filter(p => p.stock === 0);
  else if (level === 'low') list = list.filter(p => p.stock > 0 && p.stock < 5);
  else if (level === 'in')  list = list.filter(p => p.stock >= 5);
  renderInventory(list);
}

// ══════════════════════════════════════════════════════════
//  RENDER: CUSTOMERS  (with restrict / block)
// ══════════════════════════════════════════════════════════
let ALL_CUSTOMERS = [];   // cache for filter
let customerFilterText   = '';
let customerFilterStatus = 'all';

async function renderCustomersFromOrders() {
  const emailMap = {};
  ORDERS.forEach(o => {
    const email = o.email || o.userEmail;
    if (!email) return;
    if (!emailMap[email]) emailMap[email] = { name: o.customer, email, phone: o.phone||'', orders:0, spent:0, joined: o.date, account_status: 'active', restriction_reason: null, admin_note: null };
    emailMap[email].orders++;
    emailMap[email].spent += o.total || 0;
  });

  const { data: supaUsers } = await db.from('users').select('*');
  (supaUsers || []).forEach(u => {
    if (!emailMap[u.email]) {
      emailMap[u.email] = {
        name: (u.fname||'') + ' ' + (u.lname||''), email: u.email,
        phone: u.phone||'—', orders:0, spent:0,
        joined: u.joined ? new Date(u.joined).toLocaleDateString('en-PH') : '—',
        account_status: u.account_status || 'active',
        restriction_reason: u.restriction_reason || null,
        admin_note: u.admin_note || null,
      };
    } else {
      if (u.phone)               emailMap[u.email].phone              = u.phone;
      if (u.account_status)      emailMap[u.email].account_status     = u.account_status;
      if (u.restriction_reason)  emailMap[u.email].restriction_reason = u.restriction_reason;
      if (u.admin_note)          emailMap[u.email].admin_note         = u.admin_note;
    }
  });

  ALL_CUSTOMERS = Object.values(emailMap);
  renderCustomerRows();
}

function renderCustomerRows() {
  const tbody = document.getElementById('customers-tbody');
  let rows = ALL_CUSTOMERS;

  if (customerFilterText) {
    const s = customerFilterText.toLowerCase();
    rows = rows.filter(c => c.name.toLowerCase().includes(s) || c.email.toLowerCase().includes(s) || (c.phone||'').includes(s));
  }
  if (customerFilterStatus !== 'all') {
    rows = rows.filter(c => (c.account_status || 'active') === customerFilterStatus);
  }

  if (!rows.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>No customers found.</p></div></td></tr>`;
    return;
  }
  tbody.innerHTML = rows.map(c => {
    const status = c.account_status || 'active';
    const statusBadge = status === 'blocked'
      ? `<span class="badge cancelled">Blocked</span>`
      : status === 'restricted'
      ? `<span class="badge low-stock">Restricted</span>`
      : `<span class="badge in-stock">Active</span>`;

    const actionBtns = status === 'active'
      ? `<button class="btn btn-warn btn-xs" onclick="openCustomerAction('restrict','${encodeURIComponent(c.email)}','${encodeURIComponent(c.name)}')">Restrict</button>
         <button class="btn btn-danger btn-xs" onclick="openCustomerAction('block','${encodeURIComponent(c.email)}','${encodeURIComponent(c.name)}')">Block</button>`
      : status === 'restricted'
      ? `<button class="btn btn-danger btn-xs" onclick="openCustomerAction('block','${encodeURIComponent(c.email)}','${encodeURIComponent(c.name)}')">Block</button>
         <button class="btn btn-ghost btn-xs" onclick="openCustomerAction('unblock','${encodeURIComponent(c.email)}','${encodeURIComponent(c.name)}')">Lift</button>`
      : `<button class="btn btn-ghost btn-xs" onclick="openCustomerAction('unblock','${encodeURIComponent(c.email)}','${encodeURIComponent(c.name)}')">Unblock</button>`;

    const rowClass = status === 'blocked' ? 'customer-row-blocked' : status === 'restricted' ? 'customer-row-restricted' : '';
    return `
    <tr class="${rowClass}">
      <td><div class="customer-name">${c.name}</div></td>
      <td class="text-sm-muted">${c.email}</td>
      <td class="text-sm text-mono">${c.phone||'—'}</td>
      <td class="text-mono text-center">${c.orders}</td>
      <td class="text-mono text-bolder text-accent">₱${c.spent.toLocaleString()}</td>
      <td class="text-xs-muted text-mono">${c.joined||'—'}</td>
      <td>${statusBadge}</td>
      <td><div class="product-actions">${actionBtns}</div></td>
    </tr>`;
  }).join('');
}

function filterCustomers(q) {
  customerFilterText = q;
  renderCustomerRows();
}

function filterCustomersByStatus(status) {
  customerFilterStatus = status;
  renderCustomerRows();
}

// ── CUSTOMER ACTION MODAL ──
let camPendingAction = null;   // { action, email, name }

function openCustomerAction(action, encodedEmail, encodedName) {
  const email = decodeURIComponent(encodedEmail);
  const name  = decodeURIComponent(encodedName);
  camPendingAction = { action, email, name };

  const modal    = document.getElementById('customer-action-modal');
  const titleEl  = document.getElementById('cam-title');
  const subEl    = document.getElementById('cam-subtitle');
  const warnEl   = document.getElementById('cam-warning');
  const confirmBtn = document.getElementById('cam-confirm-btn');
  const reasonGrp  = document.getElementById('cam-reason-group');
  const noteGrp    = document.getElementById('cam-note-group');

  document.getElementById('cam-customer-card').innerHTML = `
    <div class="cam-avatar">${name.split(' ').map(w=>w[0]).join('').slice(0,2).toUpperCase()}</div>
    <div class="cam-info">
      <div class="cam-name">${name}</div>
      <div class="cam-email">${email}</div>
    </div>`;

  document.getElementById('cam-note').value   = '';
  document.getElementById('cam-reason').value = 'suspicious_activity';

  if (action === 'restrict') {
    titleEl.textContent   = 'Restrict Customer';
    subEl.textContent     = 'The customer can still browse but cannot place new orders.';
    warnEl.innerHTML      = `This customer will be notified that their account has been restricted.`;
    warnEl.className      = 'cam-warning cam-warning-warn';
    confirmBtn.className  = 'btn btn-warn';
    confirmBtn.textContent = 'Restrict Account';
    reasonGrp.style.display = '';
    noteGrp.style.display   = '';
  } else if (action === 'block') {
    titleEl.textContent   = 'Block Customer';
    subEl.textContent     = 'The customer will be completely blocked from the store.';
    warnEl.innerHTML      = `This is a serious action. The customer will lose access to their account immediately.`;
    warnEl.className      = 'cam-warning cam-warning-danger';
    confirmBtn.className  = 'btn btn-danger';
    confirmBtn.textContent = 'Block Account';
    reasonGrp.style.display = '';
    noteGrp.style.display   = '';
  } else {
    titleEl.textContent   = 'Lift Restriction / Unblock';
    subEl.textContent     = 'Restore full access to this customer account.';
    warnEl.innerHTML      = `The customer will regain full access to the store.`;
    warnEl.className      = 'cam-warning cam-warning-ok';
    confirmBtn.className  = 'btn btn-primary';
    confirmBtn.textContent = 'Restore Access';
    reasonGrp.style.display = 'none';
    noteGrp.style.display   = 'none';
  }

  modal.classList.add('open');
}

function closeCustomerActionModal() {
  document.getElementById('customer-action-modal').classList.remove('open');
  camPendingAction = null;
}

async function confirmCustomerAction() {
  if (!camPendingAction) return;
  if (!can('manage_all')) { showToast('Owner role required to manage customers', 'err'); closeCustomerActionModal(); return; }
  const { action, email } = camPendingAction;
  const reason = document.getElementById('cam-reason')?.value || null;
  const note   = document.getElementById('cam-note')?.value.trim() || null;

  const newStatus = action === 'restrict' ? 'restricted' : action === 'block' ? 'blocked' : 'active';
  const update    = { account_status: newStatus };
  if (action !== 'unblock') {
    update.restriction_reason = reason;
    update.admin_note         = note || null;
    update.restricted_at      = new Date().toISOString();
  } else {
    update.restriction_reason = null;
    update.admin_note         = null;
    update.restricted_at      = null;
  }

  const { error } = await db.from('users').update(update).eq('email', email);
  if (error) {
    showToast('Failed to update customer status', 'err');
    console.error(error);
    return;
  }

  const label = action === 'restrict' ? 'restricted' : action === 'block' ? 'blocked' : 'restored';
  showToast(`Customer ${label} successfully.`, action === 'unblock' ? '' : 'warn');
  closeCustomerActionModal();
  await renderCustomersFromOrders();
}


// ══════════════════════════════════════════════════════════
//  REPORTS — Live from Supabase, Monthly / Yearly periods
// ══════════════════════════════════════════════════════════

let reportPeriod   = 'monthly';
let reportOffset   = 0;

function setReportPeriod(period, el) {
  reportPeriod = period;
  reportOffset = 0;
  document.querySelectorAll('.report-tab').forEach(t => t.classList.remove('active'));
  if (el) el.classList.add('active');
  renderReports();
}

function shiftReportPeriod(dir) {
  reportOffset += dir;
  renderReports();
}

function getReportRange() {
  const now = new Date();
  if (reportPeriod === 'monthly') {
    const d     = new Date(now.getFullYear(), now.getMonth() + reportOffset, 1);
    const start = new Date(d.getFullYear(), d.getMonth(), 1);
    const end   = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59);
    const label = start.toLocaleDateString('en-PH', { month: 'long', year: 'numeric' });
    return { start, end, label, buckets: 'days' };
  } else {
    const year  = now.getFullYear() + reportOffset;
    const start = new Date(year, 0, 1);
    const end   = new Date(year, 11, 31, 23, 59, 59);
    return { start, end, label: String(year), buckets: 'months' };
  }
}

async function renderReports() {
  const { start, end, label, buckets } = getReportRange();
  document.getElementById('report-period-label').textContent = label;

  const now = new Date();
  const isLatest = reportPeriod === 'monthly'
    ? (start.getFullYear() === now.getFullYear() && start.getMonth() === now.getMonth())
    : (start.getFullYear() === now.getFullYear());
  const nextBtn = document.querySelector('.report-period-nav button:last-child');
  if (nextBtn) nextBtn.disabled = isLatest;

  ['rpt-revenue','rpt-orders','rpt-aov','rpt-cancelled'].forEach(id => {
    const el = document.getElementById(id); if (el) el.textContent = '—';
  });
  const chartEl = document.getElementById('report-rev-chart');
  if (chartEl) chartEl.innerHTML = '<div style="color:var(--text3);font-size:12px;font-family:var(--mono);padding:20px 0">Loading...</div>';

  try {
    // FIXED: use 'date' and 'payment' to match your actual columns
    const { data: orders, error } = await db
      .from('orders')
      .select('id, total, status, date, payment, items')
      .gte('date', start.toISOString())
      .lte('date', end.toISOString());
    if (error) throw error;

    const completed  = orders.filter(o => o.status !== 'cancelled');
    const cancelled  = orders.filter(o => o.status === 'cancelled');
    const totalRev   = completed.reduce((s, o) => s + (o.total || 0), 0);
    const totalOrd   = completed.length;
    const aov        = totalOrd ? totalRev / totalOrd : 0;
    const cancelRate = orders.length ? ((cancelled.length / orders.length) * 100).toFixed(1) : '0.0';

    document.getElementById('rpt-revenue').textContent       = '₱' + totalRev.toLocaleString('en-PH');
    document.getElementById('rpt-revenue-sub').textContent   = label;
    document.getElementById('rpt-orders').textContent        = totalOrd;
    document.getElementById('rpt-orders-sub').textContent    = label;
    document.getElementById('rpt-aov').textContent           = '₱' + Math.round(aov).toLocaleString('en-PH');
    document.getElementById('rpt-cancelled').textContent     = cancelled.length;
    document.getElementById('rpt-cancelled-sub').textContent = cancelRate + '% rate';

    renderReportChart(completed, start, end, buckets, label);
    renderReportCategory(completed);
    renderReportPayment(completed);
    renderReportTopProducts(completed);
  } catch (e) {
    console.error('renderReports error:', e);
    ['rpt-revenue','rpt-orders','rpt-aov','rpt-cancelled'].forEach(id => {
      const el = document.getElementById(id); if (el) el.textContent = 'Error';
    });
  }
}

function renderReportChart(orders, start, end, buckets, label) {
  const chartEl = document.getElementById('report-rev-chart');
  if (!chartEl) return;
  document.getElementById('rpt-chart-title').textContent =
    buckets === 'days' ? 'DAILY REVENUE — ' + label : 'MONTHLY REVENUE — ' + label;

  if (buckets === 'days') {
    const daysInMonth = new Date(end).getDate();
    const keys   = [];
    const labels = [];
    for (let d = 1; d <= daysInMonth; d++) {
      keys.push(new Date(start.getFullYear(), start.getMonth(), d).toDateString());
      labels.push(d % 5 === 1 ? String(d) : '');
    }
    // FIXED: use 'date' field instead of 'created_at'
    const values  = keys.map(k => orders.filter(o => new Date(o.date).toDateString() === k).reduce((s,o) => s+(o.total||0),0));
    const max     = Math.max(...values, 1);
    const todayStr = new Date().toDateString();
    chartEl.innerHTML = values.map((v, i) => `
      <div class="rev-bar-wrap">
        <div class="rev-bar${keys[i]===todayStr?' today':''}" style="height:${Math.round((v/max)*100)}%" title="Day ${i+1}: ₱${v.toLocaleString()}"></div>
        <span class="rev-month">${labels[i]}</span>
      </div>`).join('');
  } else {
    const monthNames = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
    // FIXED: use 'date' field instead of 'created_at'
    const values = monthNames.map((_,m) => orders.filter(o => new Date(o.date).getMonth()===m).reduce((s,o) => s+(o.total||0),0));
    const max    = Math.max(...values, 1);
    const curMonth = new Date().getMonth();
    const selYear  = start.getFullYear();
    chartEl.innerHTML = values.map((v, i) => `
      <div class="rev-bar-wrap">
        <div class="rev-bar${i===curMonth&&selYear===new Date().getFullYear()?' today':''}" style="height:${Math.round((v/max)*100)}%" title="${monthNames[i]}: ₱${v.toLocaleString()}"></div>
        <span class="rev-month">${monthNames[i]}</span>
      </div>`).join('');
  }
}

function renderReportCategory(orders) {
  // Build name→category lookup from the PRODUCTS catalog already in memory
  const productCatMap = {};
  (PRODUCTS || []).forEach(p => {
    if (p.name) productCatMap[p.name.trim().toLowerCase()] = p.cat || 'Uncategorized';
  });

  const catTotals = {};   // { cat: { revenue, qty } }
  orders.forEach(o => {
    let items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      let cat = item.category || item.cat || '';
      if (!cat) {
        const key = (item.name || item.product_name || '').trim().toLowerCase();
        cat = productCatMap[key] || 'Uncategorized';
      }
      const qty = item.qty || item.quantity || 1;
      const rev = (item.price || 0) * qty;
      if (!catTotals[cat]) catTotals[cat] = { revenue: 0, qty: 0 };
      catTotals[cat].revenue += rev;
      catTotals[cat].qty     += qty;
    });
  });

  const sorted   = Object.entries(catTotals).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev   = Math.max(...sorted.map(x => x[1].revenue), 1);
  const totalRev = sorted.reduce((s, [, v]) => s + v.revenue, 0);
  const colors   = ['', 'info', 'warn', '', 'info', 'warn'];
  const el       = document.getElementById('rpt-category-chart');
  if (!el) return;
  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;font-family:var(--mono)">No data for this period</div>';
    return;
  }
  el.innerHTML = sorted.map(([cat, stats], i) => {
    const barPct   = Math.round((stats.revenue / maxRev) * 100);   // bar width: relative to top category
    const sharePct = totalRev > 0 ? (stats.revenue / totalRev * 100).toFixed(1) : '0.0';  // label: share of all revenue
    const revFmt   = stats.revenue >= 1000
      ? '₱' + (stats.revenue / 1000).toFixed(1) + 'k'
      : '₱' + stats.revenue.toLocaleString('en-PH');
    return `
    <div class="rpt-bar-row">
      <span class="rpt-bar-label" title="${cat}">${cat}</span>
      <div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${barPct}%"></div></div>
      <span class="rpt-bar-value">${revFmt}<span class="rpt-bar-pct">${sharePct}%</span></span>
    </div>`;
  }).join('');
}

function renderReportPayment(orders) {
  const pmTotals = {};   // { method: { count, revenue } }
  orders.forEach(o => {
    const pm = (o.payment || 'Unknown').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
    if (!pmTotals[pm]) pmTotals[pm] = { count: 0, revenue: 0 };
    pmTotals[pm].count++;
    pmTotals[pm].revenue += o.total || 0;
  });

  const totalOrders = orders.length || 1;
  const sorted      = Object.entries(pmTotals).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev      = Math.max(...sorted.map(x => x[1].revenue), 1);
  const colors      = ['warn', '', 'info', '', 'warn'];
  const el          = document.getElementById('rpt-payment-chart');
  if (!el) return;
  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;font-family:var(--mono)">No data for this period</div>';
    return;
  }
  el.innerHTML = sorted.map(([pm, stats], i) => {
    const barPct     = Math.round((stats.revenue / maxRev) * 100);
    const orderShare = (stats.count / totalOrders * 100).toFixed(1);
    const revFmt     = stats.revenue >= 1000
      ? '₱' + (stats.revenue / 1000).toFixed(1) + 'k'
      : '₱' + stats.revenue.toLocaleString('en-PH');
    return `
    <div class="rpt-bar-row">
      <span class="rpt-bar-label" title="${pm}">${pm}</span>
      <div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${barPct}%"></div></div>
      <span class="rpt-bar-value">${revFmt}<span class="rpt-bar-pct">${stats.count} orders · ${orderShare}%</span></span>
    </div>`;
  }).join('');
}

function renderReportTopProducts(orders) {
  // Build name→category lookup from the PRODUCTS catalog already in memory
  const productCatMap = {};
  (PRODUCTS || []).forEach(p => {
    if (p.name) productCatMap[p.name.trim().toLowerCase()] = p.cat || '—';
  });

  const prodMap = {};   // { name: { qty, revenue, price, cat } }
  orders.forEach(o => {
    let items = o.items;
    if (typeof items === 'string') { try { items = JSON.parse(items); } catch(e) { items = []; } }
    if (!Array.isArray(items)) return;
    items.forEach(item => {
      const name = item.name || item.product_name || 'Unknown';
      const key  = name.trim().toLowerCase();
      if (!prodMap[name]) prodMap[name] = { qty: 0, revenue: 0, price: item.price || 0, cat: productCatMap[key] || '—' };
      const qty = item.qty || item.quantity || 1;
      prodMap[name].qty     += qty;
      prodMap[name].revenue += (item.price || 0) * qty;
    });
  });

  const all      = Object.entries(prodMap).sort((a, b) => b[1].revenue - a[1].revenue);
  const sorted   = all.slice(0, 10);
  const totalRev = all.reduce((s, [, v]) => s + v.revenue, 0) || 1;  // ALL products, not just top-10
  const tbody    = document.getElementById('rpt-top-products');
  if (!tbody) return;
  if (!sorted.length) {
    tbody.innerHTML = '<tr><td colspan="5" style="color:var(--text3);font-family:var(--mono);font-size:12px">No data for this period</td></tr>';
    return;
  }
  tbody.innerHTML = sorted.map(([name, stats], i) => {
    const sharePct = (stats.revenue / totalRev * 100).toFixed(1);
    const shareBar = Math.round(stats.revenue / (sorted[0][1].revenue || 1) * 100);
    return `
    <tr>
      <td style="color:var(--text3);font-family:var(--mono);font-size:12px;white-space:nowrap">${i + 1}</td>
      <td>
        <div style="font-weight:500;font-size:13px">${name}</div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono)">${stats.cat}</div>
      </td>
      <td style="font-family:var(--mono);font-size:13px;white-space:nowrap">₱${stats.price.toLocaleString('en-PH')}</td>
      <td style="font-family:var(--mono);font-size:13px;text-align:center">${stats.qty}</td>
      <td style="min-width:160px">
        <div style="display:flex;align-items:center;gap:8px">
          <div style="flex:1;height:6px;background:var(--surface3);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${shareBar}%;background:var(--accent);border-radius:3px;transition:width 0.5s ease"></div>
          </div>
          <span style="font-family:var(--mono);font-size:12px;color:var(--accent);font-weight:600;white-space:nowrap">₱${stats.revenue.toLocaleString('en-PH')}</span>
        </div>
        <div style="font-size:11px;color:var(--text3);font-family:var(--mono);margin-top:2px">${sharePct}% of period revenue</div>
      </td>
    </tr>`;
  }).join('');
}

// Dashboard rev chart — last 7 days
function renderRevChart() {
  const days = [];
  for (let i = 6; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate()-i); days.push(d.toDateString()); }
  const dayLabels  = ['6d ago','5d','4d','3d','2d','Yest','Today'];
  const dayRevenue = days.map(dayStr =>
    ORDERS.filter(o => { try { return new Date(o.date||o.created_at).toDateString()===dayStr; } catch(e){ return false; } })
          .reduce((s,o) => s+(o.total||0), 0)
  );
  const max     = Math.max(...dayRevenue, 1);
  const chartEl = document.getElementById('rev-chart');
  if (!chartEl) return;
  chartEl.innerHTML = dayRevenue.map((v,i) => `
    <div class="rev-bar-wrap">
      <div class="rev-bar${i===6?' today':''}" style="height:${Math.round((v/max)*100)}%" title="\u20B1${v.toLocaleString()}"></div>
      <span class="rev-month">${dayLabels[i]}</span>
    </div>`).join('');
}


function badgeHTML(status) {
  const label = status.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
  const cls   = status === 'out_for_delivery' ? 'shipped' : status;
  return `<span class="badge ${cls}">${label}</span>`;
}

// ══════════════════════════════════════════════════════════
//  RENDER: DASHBOARD STATS (live from ORDERS + PRODUCTS)
// ══════════════════════════════════════════════════════════
function renderDashboardStats() {
  const todayStr    = new Date().toDateString();
  const yesterStr   = new Date(Date.now() - 86400000).toDateString();

  const todayOrders = ORDERS.filter(o => {
    try { return new Date(o.date || o.created_at).toDateString() === todayStr && o.status !== 'cancelled'; } catch(e) { return false; }
  });
  const yesterOrders = ORDERS.filter(o => {
    try { return new Date(o.date || o.created_at).toDateString() === yesterStr && o.status !== 'cancelled'; } catch(e) { return false; }
  });

  const todayRev   = todayOrders.reduce((s, o)  => s + (o.total || 0), 0);
  const yesterRev  = yesterOrders.reduce((s, o) => s + (o.total || 0), 0);
  const totalOrders = ORDERS.filter(o => o.status !== 'cancelled').length;

  // Today's revenue card
  const revEl = document.getElementById('dash-today-revenue');
  if (revEl) revEl.textContent = '\u20B1' + todayRev.toLocaleString('en-PH');

  const revChangeEl = document.getElementById('dash-revenue-change');
  if (revChangeEl) {
    if (yesterRev === 0 && todayRev === 0) {
      revChangeEl.innerHTML = '<span>No sales today</span>';
    } else if (yesterRev === 0) {
      revChangeEl.innerHTML = '<span class="up">New sales today</span>';
    } else {
      const pct = Math.round(((todayRev - yesterRev) / yesterRev) * 100);
      const dir = pct >= 0 ? 'up' : 'down';
      const arrow = pct >= 0 ? '\u2191' : '\u2193';
      revChangeEl.innerHTML = `<span class="${dir}">${arrow} ${Math.abs(pct)}%</span> vs yesterday`;
    }
  }

  // Total orders card
  const thisWeekStart = new Date(); thisWeekStart.setDate(thisWeekStart.getDate() - 6); thisWeekStart.setHours(0,0,0,0);
  const weekOrders = ORDERS.filter(o => {
    try { return new Date(o.date || o.created_at) >= thisWeekStart && o.status !== 'cancelled'; } catch(e) { return false; }
  }).length;
  const totEl = document.getElementById('dash-total-orders');
  if (totEl) totEl.textContent = totalOrders;
  const totChgEl = document.getElementById('dash-total-orders-change');
  if (totChgEl) totChgEl.innerHTML = `<span class="up">\u2191 ${weekOrders}</span> this week`;

  // Low stock card
  const lowCount = PRODUCTS.filter(p => p.stock > 0 && p.stock < 5).length;
  const outCount = PRODUCTS.filter(p => p.stock === 0).length;
  const lowEl = document.getElementById('dash-lowstock');
  if (lowEl) lowEl.textContent = lowCount + outCount;

  // Top categories bar chart
  renderDashCategories();

  // Low stock alerts table
  renderDashLowStock();
}

function renderDashCategories() {
  const el = document.getElementById('dash-categories-chart');
  if (!el) return;

  // Build category revenue from all non-cancelled orders
  const catTotals = {};
  ORDERS.filter(o => o.status !== 'cancelled').forEach(o => {
    (o.items || []).forEach(item => {
      const key  = (item.name || '').trim().toLowerCase();
      const prod = PRODUCTS.find(p => p.name.trim().toLowerCase() === key);
      const cat  = prod?.cat || item.category || item.cat || 'Other';
      const rev  = (item.price || 0) * (item.qty || 1);
      if (!catTotals[cat]) catTotals[cat] = 0;
      catTotals[cat] += rev;
    });
  });

  const sorted = Object.entries(catTotals).sort((a, b) => b[1] - a[1]).slice(0, 5);
  if (!sorted.length) {
    el.innerHTML = '<div style="color:var(--text3);font-size:12px;font-family:var(--mono)">No sales data yet</div>';
    return;
  }
  const maxRev = sorted[0][1] || 1;
  const colors = ['', 'info', 'warn', '', 'info'];
  el.innerHTML = sorted.map(([cat, rev], i) => {
    const w    = Math.round((rev / maxRev) * 100);
    const disp = rev >= 1000 ? '\u20B1' + (rev/1000).toFixed(1) + 'k' : '\u20B1' + rev.toLocaleString('en-PH');
    const lbl  = cat.length > 9 ? cat.slice(0, 8) + '.' : cat;
    return `<div class="bar-row"><span class="bar-label">${lbl}</span><div class="bar-track"><div class="bar-fill ${colors[i]}" style="width:${w}%"></div></div><span class="bar-value">${disp}</span></div>`;
  }).join('');
}

function renderDashLowStock() {
  const tbody = document.getElementById('dash-lowstock-tbody');
  if (!tbody) return;
  const items = PRODUCTS.filter(p => p.stock === 0 || p.stock < 5).sort((a, b) => a.stock - b.stock).slice(0, 5);
  if (!items.length) {
    tbody.innerHTML = '<tr><td colspan="4" style="color:var(--text3);font-family:var(--mono);font-size:12px;padding:16px">All products are well-stocked!</td></tr>';
    return;
  }
  tbody.innerHTML = items.map(p => {
    const badge = p.stock === 0
      ? '<span class="badge out">Out of Stock</span>'
      : `<span class="badge low-stock">${p.stock} left</span>`;
    return `
    <tr>
      <td><div class="product-thumb"><div class="thumb-img">${p.image_url ? `<img src="${p.image_url}" style="width:100%;height:100%;object-fit:cover;border-radius:4px;">` : (p.emoji || '')}</div><div><div class="thumb-name">${p.name}</div></div></div></td>
      <td><span class="text-mono-xs">${p.sku || '—'}</span></td>
      <td>${badge}</td>
      <td><button class="btn btn-warn btn-xs" onclick="showPage('inventory',document.getElementById('nav-orders').nextElementSibling.nextElementSibling);showToast('Go to Inventory to adjust stock','warn')">Restock</button></td>
    </tr>`;
  }).join('');
}

// ══════════════════════════════════════════════════════════
//  ORDER MODAL
// ══════════════════════════════════════════════════════════
function openOrder(id) {
  const o = ORDERS.find(x => x.id === id);
  if (!o) return;

  document.getElementById('modal-order-id').textContent   = '#' + o.id;
  document.getElementById('modal-order-date').textContent = 'Placed on ' + o.date + (o._fromShop ? '' : '');

  const riderSection = o.riderName ? `
    <div class="order-section">
      <div class="order-section-title">Assigned Rider</div>
      <div class="customer-info">
        <p><strong>${o.riderName}</strong></p>
        <p><span>${o.riderPhone || '—'}</span></p>
        <p><span>${o.riderPlate || '—'}</span></p>
        ${o.riderAcceptedAt ? `<p><span>Accepted at ${new Date(o.riderAcceptedAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span></p>` : ''}
        ${o.deliveredAt     ? `<p><span>Delivered at ${new Date(o.deliveredAt).toLocaleTimeString('en-PH',{hour:'2-digit',minute:'2-digit'})}</span></p>` : ''}
        <p><span style="color:var(--warn)">${formatRiderStep(o.riderStep, o.status)}</span></p>
      </div>
    </div>` : `
    <div class="order-section">
      <div class="order-section-title">Rider Assignment</div>
      <div style="font-size:13px;color:var(--text3);padding:4px 0">
        ${o.status === 'pending' || o.status === 'processing'
          ? 'No rider yet — available riders will see this in their queue once status is set to Processing.'
          : o.status === 'delivered' || o.status === 'cancelled' ? 'Order closed.' : 'Waiting for a rider to accept.'}
      </div>
    </div>`;

  const statusFlow     = ['pending','processing','out_for_delivery','delivered'];
  const cancelledOrRefunded = o.status === 'cancelled';
  const currentIdx     = statusFlow.indexOf(o.status);
  const timelineItems  = [
    { label:'Order Placed',   done: true },
    { label:'Processing',     done: currentIdx >= 1 },
    { label:'Rider Accepted', done: !!o.riderAcceptedAt },
    { label:'Picked Up',      done: o.riderStep === 'picked_up' || o.riderStep === 'on_the_way' || o.riderStep === 'delivered' || o.status === 'delivered' },
    { label:'On the Way',     done: o.riderStep === 'on_the_way' || o.riderStep === 'delivered' || o.status === 'delivered' },
    { label:'Delivered',      done: o.status === 'delivered' },
  ];

  const timelineHTML = cancelledOrRefunded
    ? `<div class="tl-item"><div class="tl-dot cancelled">✕</div><div class="tl-content"><div class="tl-event cancelled">Cancelled</div></div></div>`
    : timelineItems.filter(t => t.done).map(t => `
        <div class="tl-item">
          <div class="tl-dot done">✓</div>
          <div class="tl-content"><div class="tl-event">${t.label}</div></div>
        </div>`).join('');

  document.getElementById('modal-order-body').innerHTML = `
    <div class="order-body order-body-no-pad">
      <div class="order-section">
        <div class="order-section-title">Customer & Shipping</div>
        <div class="customer-info">
          <p><strong>${o.customer}</strong></p>
          <p><span>${o.email}</span></p>
          <p><span>${o.phone}</span></p>
          <p><span>${o.address}</span></p>
        </div>
      </div>
      ${riderSection}
      <div class="order-section">
        <div class="order-section-title">Order Items</div>
        ${o.items.map(it => `
          <div class="order-item-row">
            <span>${it.name} × ${it.qty}</span>
            <span class="item-price">₱${(it.price*it.qty).toLocaleString()}</span>
          </div>`).join('')}
        <div class="order-total-row"><span>Subtotal</span><span class="order-subtotal">₱${(o.total-50).toLocaleString()}</span></div>
        <div class="order-total-row"><span>Shipping</span><span class="order-subtotal">₱50</span></div>
        <div class="order-total-row grand"><span>Total</span><span>₱${o.total.toLocaleString()}</span></div>
      </div>
      <div class="order-section">
        <div class="order-section-title">Order Status</div>
        <div class="flex-gap-8-wrap" style="align-items:center;gap:10px">
          <span>Current: ${badgeHTML(o.status)}</span>
          ${o.status === 'pending'
            ? `<button class="btn btn-primary btn-sm" onclick="updateStatus('${o.id}','processing');closeOrderModal()">Confirm Order</button>
               <button class="btn btn-danger btn-sm" onclick="updateStatus('${o.id}','cancelled');closeOrderModal()">Cancel Order</button>`
            : o.status === 'processing'
            ? `<button class="btn btn-danger btn-sm" onclick="updateStatus('${o.id}','cancelled');closeOrderModal()">Cancel Order</button>
               <span class="text-xs-muted" style="font-family:var(--mono);font-size:11px">Awaiting rider — further status updates are rider-driven</span>`
            : o.status === 'cancelled'
            ? `<span class="text-xs-muted" style="font-family:var(--mono);font-size:11px">Order is closed</span>`
            : `<span class="text-xs-muted" style="font-family:var(--mono);font-size:11px">Status controlled by rider delivery progress</span>`}
        </div>
      </div>
      <div class="order-section">
        <div class="order-section-title">Order Timeline</div>
        <div class="timeline">${timelineHTML}</div>
      </div>
    </div>`;

  document.getElementById('order-modal').classList.add('open');
}

function closeOrderModal() { document.getElementById('order-modal').classList.remove('open'); }

// ── STATUS UPDATE ──
async function updateStatus(id, newStatus) {
  if (!newStatus) return;
  if (!can('manage_all')) { showToast('Owner role required to update orders', 'err'); return; }

  // Admin can only confirm (→ processing) or cancel orders.
  // All delivery statuses (out_for_delivery, delivered, etc.) are rider-driven.
  const adminAllowed = ['processing', 'cancelled'];
  if (!adminAllowed.includes(newStatus)) {
    showToast('Delivery status is controlled by the rider', 'warn');
    return;
  }

  const o = ORDERS.find(x => x.id === id);
  if (!o) return;

  // Guard: can only cancel if order hasn't been picked up yet
  if (newStatus === 'cancelled' && (o.status === 'out_for_delivery' || o.status === 'delivered')) {
    showToast('Cannot cancel an order already out for delivery', 'err');
    return;
  }

  o.status = newStatus;
  await saveOrderStatusToSupabase(id, newStatus);
  renderOrders(filteredOrders);
  renderDashOrders();
  updateBadges();
  showToast(`Order #${id} → ${newStatus.replace(/_/g,' ')}`);
}

// ── ORDER FILTERS ──
function applyOrderFilters() {
  const searchEl  = document.querySelector('#page-orders .search-input');
  const statusEl  = document.querySelector('#page-orders .filter-select[title="Filter by status"]');
  const paymentEl = document.getElementById('orders-payment-filter');
  const q       = (searchEl?.value  || '').toLowerCase();
  const status  = statusEl?.value   || 'all';
  const payment = paymentEl?.value  || 'all';

  filteredOrders = ORDERS.filter(o => {
    if (q && !o.id.toLowerCase().includes(q) && !o.customer.toLowerCase().includes(q)) return false;
    if (status  !== 'all' && o.status  !== status)  return false;
    if (payment !== 'all' && o.payment !== payment.toUpperCase()) return false;
    return true;
  });
  renderOrders(filteredOrders);
}

function filterOrders(q) {
  applyOrderFilters();
}

function filterOrdersByStatus(status) {
  applyOrderFilters();
}

function filterOrdersByPayment(payment) {
  applyOrderFilters();
}

// ══════════════════════════════════════════════════════════
//  PRODUCT CRUD — Supabase
// ══════════════════════════════════════════════════════════
function openAddProduct() {
  if (!can('manage_products')) { showToast('Manager or Owner role required', 'err'); return; }
  // Clear all fields
  ['p-name','p-sku','p-price','p-stock','p-desc','p-emoji','p-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  clearImageUpload();
  document.getElementById('product-modal').dataset.editIndex = '';
  document.querySelector('.modal-overlay#product-modal .modal-title').textContent = 'Add New Product';
  document.getElementById('product-modal-submit').textContent = 'Add Product';
  document.getElementById('product-modal').classList.add('open');
}

function openEditProduct(i) {
  if (!can('manage_products')) { showToast('Manager or Owner role required', 'err'); return; }
  const p = PRODUCTS[i];
  if (!p) return;
  ['p-name','p-sku','p-price','p-stock','p-desc','p-emoji','p-cat'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    const field = id.replace('p-', '');
    if (field === 'price' || field === 'stock') el.value = p[field] ?? '';
    else el.value = p[field] || '';
  });

  // Restore image preview if product has one
  clearImageUpload();
  if (p.image_url) {
    document.getElementById('p-image-url').value = p.image_url;
    const area    = document.getElementById('img-upload-area');
    const preview = document.getElementById('img-upload-preview');
    preview.innerHTML = `
      <img src="${p.image_url}" alt="Product image">
      <div class="img-upload-overlay">
        <button class="img-upload-change" onclick="event.stopPropagation();document.getElementById('p-image-file').click()">Change</button>
        <button class="img-upload-remove" onclick="event.stopPropagation();clearImageUpload()">Remove</button>
      </div>`;
    area.classList.add('has-image');
  }

  document.getElementById('product-modal').dataset.editIndex = i;
  document.querySelector('.modal-overlay#product-modal .modal-title').textContent = 'Edit Product';
  document.getElementById('product-modal-submit').textContent = 'Save Changes';
  document.getElementById('product-modal').classList.add('open');
}

async function addProduct() {
  const name  = document.getElementById('p-name')?.value.trim();
  const price = parseFloat(document.getElementById('p-price')?.value || '0');
  const stock = parseInt(document.getElementById('p-stock')?.value || '0');
  const sku   = document.getElementById('p-sku')?.value.trim()  || '';
  const desc  = document.getElementById('p-desc')?.value.trim() || '';
  const emoji = document.getElementById('p-emoji')?.value.trim() || '';
  const cat   = document.getElementById('p-cat')?.value.trim()  || '';

  if (!name) { showToast('Product name is required', 'err'); return; }

  const modal     = document.getElementById('product-modal');
  const editIndex = modal.dataset.editIndex;
  const submitBtn = document.getElementById('product-modal-submit');

  // Upload image if a new file was selected
  let imageUrl = document.getElementById('p-image-url')?.value || null;
  if (pendingImageFile) {
    submitBtn.textContent = 'Uploading image...';
    submitBtn.disabled    = true;
    imageUrl = await uploadProductImage(pendingImageFile, name);
    submitBtn.disabled    = false;
    if (!imageUrl) {
      submitBtn.textContent = editIndex !== '' && editIndex !== undefined ? 'Save Changes' : 'Add Product';
      return; // upload failed, error already shown
    }
    pendingImageFile = null;
  }

  if (editIndex !== '' && editIndex !== undefined) {
    // Update existing
    const p = PRODUCTS[editIndex];
    const update = { name, sku, price, stock, description: desc, emoji, category: cat };
    if (imageUrl !== null) update.image_url = imageUrl;
    const { error } = await db.from('products').update(update).eq('id', p._dbId);
    if (error) { showToast('Failed to update product', 'err'); console.error(error); return; }
    showToast(`"${name}" updated!`);
  } else {
    // Insert new
    const insert = { name, sku, price, stock, description: desc, emoji, category: cat };
    if (imageUrl) insert.image_url = imageUrl;
    const { error } = await db.from('products').insert(insert);
    if (error) { showToast('Failed to add product', 'err'); console.error(error); return; }
    showToast(`"${name}" added to catalog!`);
  }

  modal.classList.remove('open');
  clearImageUpload();
  await loadProducts();
  renderProducts();
  renderInventory();
  updateBadges();
}

async function deleteProduct(i) {
  if (!can('manage_products')) { showToast('Manager or Owner role required', 'err'); return; }
  const p = PRODUCTS[i];
  if (!p) return;
  if (!confirm(`Delete "${p.name}"? This cannot be undone.`)) return;
  const { error } = await db.from('products').delete().eq('id', p._dbId);
  if (error) { showToast('Failed to delete product', 'err'); console.error(error); return; }
  showToast(`"${p.name}" deleted`);
  await loadProducts();
  renderProducts();
  renderInventory();
  updateBadges();
}

// ── INVENTORY ADJUST — writes to Supabase ──
function openInvAdjust(i) {
  if (!can('manage_stocks')) { showToast('Manager or Owner role required', 'err'); return; }
  currentInvProduct = i;
  const p = PRODUCTS[i];
  document.getElementById('inv-modal-name').textContent = p.name + ' — Current stock: ' + p.stock;
  document.getElementById('inv-qty').value  = '';
  document.getElementById('inv-note').value = '';
  document.getElementById('inv-modal').classList.add('open');
}

async function saveStockAdjust() {
  if (currentInvProduct === null) return;
  const type = document.getElementById('inv-adj-type').value;
  const qty  = parseInt(document.getElementById('inv-qty').value) || 0;
  const p    = PRODUCTS[currentInvProduct];
  let newStock = p.stock;
  if (type === 'add')         newStock = p.stock + qty;
  else if (type === 'remove') newStock = Math.max(0, p.stock - qty);
  else if (type === 'set')    newStock = qty;

  const { error } = await db.from('products').update({ stock: newStock }).eq('id', p._dbId);
  if (error) { showToast('Failed to update stock', 'err'); console.error(error); return; }

  p.stock = newStock;
  renderInventory();
  updateBadges();
  showToast(`Stock updated: ${p.name} → ${newStock} units`);
  document.getElementById('inv-modal').classList.remove('open');
}

// ══════════════════════════════════════════════════════════
//  PROMOTIONS — Supabase `promos` table
//  Schema: id, code, discount_pct, active, description, expires_at
// ══════════════════════════════════════════════════════════
async function renderPromos() {
  const tbody = document.getElementById('promos-tbody');
  if (!tbody) return;

  const { data, error } = await db.from('promos').select('*').order('id', { ascending: false });
  if (error) { tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>Could not load promos.</p></div></td></tr>`; return; }

  if (!data || !data.length) {
    tbody.innerHTML = `<tr><td colspan="5"><div class="empty-state"><p>No promo codes yet. Add your first one.</p></div></td></tr>`;
    return;
  }

  tbody.innerHTML = data.map(promo => `
    <tr>
      <td class="text-mono text-bold">${promo.code}</td>
      <td>${promo.description || '—'}</td>
      <td class="text-mono text-bold">${promo.discount_pct}% off</td>
      <td>${promo.active ? '<span class="badge in-stock">Active</span>' : '<span class="badge cancelled">Inactive</span>'}</td>
      <td>
        <div class="product-actions">
          <button class="btn btn-ghost btn-xs" onclick="togglePromo(${promo.id}, ${!promo.active})">${promo.active ? 'Disable' : 'Enable'}</button>
          <button class="btn btn-danger btn-xs" onclick="deletePromo(${promo.id})">Del</button>
        </div>
      </td>
    </tr>`).join('');
}

async function addPromo() {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  const code    = document.getElementById('promo-code')?.value.trim().toUpperCase();
  const pct     = parseInt(document.getElementById('promo-pct')?.value || '0');
  const desc    = document.getElementById('promo-desc')?.value.trim() || '';
  if (!code || !pct) { showToast('Code and discount % required', 'err'); return; }

  const { error } = await db.from('promos').insert({ code, discount_pct: pct, description: desc, active: true });
  if (error) { showToast('Failed to add promo', 'err'); console.error(error); return; }

  showToast(`Promo code "${code}" created!`);
  ['promo-code','promo-pct','promo-desc'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  renderPromos();
}

async function togglePromo(id, active) {
  await db.from('promos').update({ active }).eq('id', id);
  renderPromos();
  showToast(active ? 'Promo enabled' : 'Promo disabled');
}

async function deletePromo(id) {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  if (!confirm('Delete this promo code?')) return;
  await db.from('promos').delete().eq('id', id);
  renderPromos();
  showToast('Promo deleted');
}

// ══════════════════════════════════════════════════════════
//  REVIEWS — Supabase `reviews` table
//  Schema: id, product_id, product_name, customer_name,
//          customer_email, rating (1-5), review_text,
//          created_at, status (published|hidden|flagged),
//          admin_reply, replied_at
// ══════════════════════════════════════════════════════════

let ALL_REVIEWS        = [];
let reviewFilterText   = '';
let reviewFilterRating = 'all';
let reviewFilterStatus = 'all';
let reviewSortMode     = 'newest';
let reviewReplyTarget  = null;

// ── SAMPLE DATA (shown when no Supabase table exists yet) ──
const SAMPLE_REVIEWS = [
  { id: 'r1', product_id: 1, product_name: 'SMOK RPM 5 Pro', customer_name: 'Carlos M.', customer_email: 'carlos@example.com', rating: 5, review_text: 'Absolutely love this device! Flavor is incredible and battery life lasts all day. Build quality feels premium. Highly recommend to anyone looking to upgrade.', created_at: new Date(Date.now() - 2*86400000).toISOString(), status: 'published', admin_reply: null, replied_at: null },
  { id: 'r2', product_id: 2, product_name: 'Naked 100 Lava Flow', customer_name: 'Maria T.', customer_email: 'maria@example.com', rating: 4, review_text: 'Really nice tropical flavor, not too sweet. Smooth hit. Would order again but wish there were bigger bottle sizes available.', created_at: new Date(Date.now() - 5*86400000).toISOString(), status: 'published', admin_reply: 'Thank you for the feedback, Maria! Larger sizes are coming soon.', replied_at: new Date(Date.now() - 4*86400000).toISOString() },
  { id: 'r3', product_id: 3, product_name: 'GeekVape Aegis Legend 2', customer_name: 'JohnPaul R.', customer_email: 'jp@example.com', rating: 2, review_text: 'The device stopped working after 2 weeks. Buttons feel cheap. Expected better for the price. Very disappointed.', created_at: new Date(Date.now() - 7*86400000).toISOString(), status: 'flagged', admin_reply: null, replied_at: null },
  { id: 'r4', product_id: 1, product_name: 'SMOK RPM 5 Pro', customer_name: 'Ana L.', customer_email: 'ana@example.com', rating: 5, review_text: 'Best pod system I\'ve tried. Great value and delivery was super fast. CloudChase never disappoints!', created_at: new Date(Date.now() - 1*86400000).toISOString(), status: 'published', admin_reply: null, replied_at: null },
  { id: 'r5', product_id: 4, product_name: 'Uwell Caliburn G3', customer_name: 'Rex B.', customer_email: 'rex@example.com', rating: 3, review_text: 'Decent device but coil burns out faster than expected. Had to replace it after just 5 days of normal use. Packaging was nice though.', created_at: new Date(Date.now() - 10*86400000).toISOString(), status: 'published', admin_reply: null, replied_at: null },
  { id: 'r6', product_id: 2, product_name: 'Naked 100 Lava Flow', customer_name: 'Grace P.', customer_email: 'grace@example.com', rating: 5, review_text: 'This juice is AMAZING. Perfect blend of pineapple and coconut. Ordered 3 bottles already! Shipping was quick too.', created_at: new Date(Date.now() - 3*86400000).toISOString(), status: 'published', admin_reply: null, replied_at: null },
];

async function loadReviews() {
  try {
    const { data, error } = await db.from('reviews').select('*').order('created_at', { ascending: false });
    if (error) {
      console.error('loadReviews query error:', error);
      if (!ALL_REVIEWS.length) ALL_REVIEWS = SAMPLE_REVIEWS;
      return;
    }
    if (!data || !data.length) {
      ALL_REVIEWS = SAMPLE_REVIEWS;
      return;
    }
    // Enrich: attach product_name from PRODUCTS catalog and customer_name from users table
    const productIdMap = {};
    (PRODUCTS || []).forEach(p => { if (p._dbId) productIdMap[p._dbId] = p.name; });

    const emails = [...new Set(data.map(r => r.user_email).filter(Boolean))];
    let userMap  = {};
    if (emails.length) {
      const { data: users } = await db.from('users').select('email, fname, lname').in('email', emails);
      (users || []).forEach(u => { userMap[u.email] = ((u.fname || '') + ' ' + (u.lname || '')).trim() || u.email; });
    }

    ALL_REVIEWS = data.map(r => ({
      ...r,
      product_name:  productIdMap[r.product_id] || r.product_name || ('Product #' + r.product_id),
      customer_name: userMap[r.user_email] || r.customer_name || r.user_email || 'Customer',
      customer_email: r.user_email || r.customer_email || '',
      review_text:   r.body || r.text || r.review_text || '',
      status:        r.status || 'published',
    }));
  } catch(e) {
    console.error('loadReviews error:', e);
    ALL_REVIEWS = SAMPLE_REVIEWS;
  }
}

function getFilteredReviews() {
  let list = [...ALL_REVIEWS];
  if (reviewFilterText) {
    const s = reviewFilterText.toLowerCase();
    list = list.filter(r =>
      (r.product_name||'').toLowerCase().includes(s) ||
      (r.customer_name||'').toLowerCase().includes(s) ||
      (r.review_text||'').toLowerCase().includes(s)
    );
  }
  if (reviewFilterRating !== 'all') {
    list = list.filter(r => r.rating === parseInt(reviewFilterRating));
  }
  if (reviewFilterStatus !== 'all') {
    list = list.filter(r => (r.status || 'published') === reviewFilterStatus);
  }
  if (reviewSortMode === 'oldest')  list.sort((a,b) => new Date(a.created_at) - new Date(b.created_at));
  if (reviewSortMode === 'newest')  list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
  if (reviewSortMode === 'highest') list.sort((a,b) => b.rating - a.rating);
  if (reviewSortMode === 'lowest')  list.sort((a,b) => a.rating - b.rating);
  return list;
}

function starsHTML(rating, size = 'sm') {
  return Array.from({length:5}, (_,i) =>
    `<span class="star star-${size} ${i < rating ? 'filled' : 'empty'}">★</span>`
  ).join('');
}

function renderReviewSummary() {
  if (!ALL_REVIEWS.length) return;
  const avg = ALL_REVIEWS.reduce((s,r) => s + r.rating, 0) / ALL_REVIEWS.length;
  const pending = ALL_REVIEWS.filter(r => !r.admin_reply && r.status !== 'hidden').length;

  document.getElementById('rev-avg-score').textContent  = avg.toFixed(1);
  document.getElementById('rev-avg-stars').innerHTML    = starsHTML(Math.round(avg), 'md');
  document.getElementById('rev-total-count').textContent = ALL_REVIEWS.length;
  document.getElementById('rev-pending-count').textContent = pending;

  // Badge on sidebar — show count of flagged + unreplied
  const flagged = ALL_REVIEWS.filter(r => r.status === 'flagged').length;
  const badgeCount = pending + flagged;
  const rb = document.getElementById('reviews-badge');
  if (rb) { rb.textContent = badgeCount; rb.style.display = badgeCount ? '' : 'none'; }

  // Distribution bars
  const distEl = document.getElementById('rev-distribution');
  if (distEl) {
    const counts = [5,4,3,2,1].map(n => ({ n, c: ALL_REVIEWS.filter(r => r.rating === n).length }));
    const max = Math.max(...counts.map(x => x.c), 1);
    distEl.innerHTML = counts.map(({ n, c }) => `
      <div class="rev-dist-row">
        <span class="rev-dist-label">${n}★</span>
        <div class="rev-dist-track">
          <div class="rev-dist-fill ${n >= 4 ? 'good' : n === 3 ? 'mid' : 'bad'}"
               style="width:${Math.round((c/max)*100)}%"></div>
        </div>
        <span class="rev-dist-count">${c}</span>
      </div>`).join('');
  }
}

async function renderReviews() {
  if (!ALL_REVIEWS.length) await loadReviews();
  renderReviewSummary();

  const list = getFilteredReviews();
  const container = document.getElementById('reviews-list');
  if (!container) return;

  if (!list.length) {
    container.innerHTML = `<div class="card"><div class="empty-state"><div class="icon">⭐</div><p>No reviews match your filters.</p></div></div>`;
    return;
  }

  container.innerHTML = list.map(r => {
    const date = r.created_at
      ? new Date(r.created_at).toLocaleDateString('en-PH',{year:'numeric',month:'short',day:'numeric'})
      : '—';

    const ratingClass = r.rating >= 4 ? 'high' : r.rating === 3 ? 'mid' : 'low';
    const status      = r.status || 'published';
    const statusBadge = status === 'hidden'
      ? `<span class="badge out">Hidden</span>`
      : status === 'flagged'
      ? `<span class="badge low-stock">Flagged</span>`
      : `<span class="badge in-stock">Published</span>`;
    const replyBadge  = r.admin_reply
      ? `<span class="rev-replied-badge">✔ Replied</span>` : '';

    return `
    <div class="review-card ${ratingClass}-review">
      <div class="review-card-header">
        <div class="review-left">
          <div class="review-avatar">${(r.customer_name||'?').charAt(0).toUpperCase()}</div>
          <div class="review-meta">
            <div class="review-customer-name">${r.customer_name}</div>
            <div class="review-customer-email">${r.customer_email || '—'}</div>
          </div>
        </div>
        <div class="review-right">
          <div class="review-stars">${starsHTML(r.rating)}</div>
          <div class="review-date">${date}</div>
        </div>
      </div>
      <div class="review-product-tag">${r.product_name || 'Unknown Product'}</div>
      <p class="review-body">"${r.review_text || ''}"</p>
      ${r.admin_reply ? `<div class="rev-admin-reply"><span class="rev-reply-label">Admin reply:</span> ${r.admin_reply}</div>` : ''}
      <div class="review-card-footer">
        <div class="rev-badges">${statusBadge}${replyBadge}</div>
        <div class="product-actions">
          <button class="btn btn-ghost btn-xs" onclick="openReviewDetail('${r.id}')">View</button>
          <button class="btn btn-ghost btn-xs" onclick="openReviewReply('${r.id}')">Reply</button>
          ${status !== 'hidden'
            ? `<button class="btn btn-warn btn-xs" onclick="setReviewStatus('${r.id}','hidden')">Hide</button>`
            : `<button class="btn btn-ghost btn-xs" onclick="setReviewStatus('${r.id}','published')">Publish</button>`}
          ${status === 'flagged'
            ? `<button class="btn btn-primary btn-xs" onclick="setReviewStatus('${r.id}','published')">Approve</button>` : ''}
          <button class="btn btn-danger btn-xs" onclick="deleteReview('${r.id}')">Del</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

function filterReviews(q)           { reviewFilterText   = q;      renderReviews(); }
function filterReviewsByRating(val) { reviewFilterRating = val;    renderReviews(); }
function filterReviewsByStatus(val) { reviewFilterStatus = val;    renderReviews(); }
function sortReviews(val)           { reviewSortMode     = val;    renderReviews(); }

async function setReviewStatus(id, status) {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  // eslint-disable-next-line eqeqeq
  const r = ALL_REVIEWS.find(x => x.id == id);
  if (!r) return;
  r.status = status;
  try { await db.from('reviews').update({ status }).eq('id', id); } catch(e) { console.error('setReviewStatus DB error:', e); }
  renderReviews();
  showToast(`Review ${status}`);
}

async function deleteReview(id) {
  if (!can('manage_all')) { showToast('Owner role required', 'err'); return; }
  if (!confirm('Delete this review? This cannot be undone.')) return;
  // eslint-disable-next-line eqeqeq
  ALL_REVIEWS = ALL_REVIEWS.filter(r => r.id != id);
  try { await db.from('reviews').delete().eq('id', id); } catch(e) {}
  renderReviews();
  showToast('Review deleted');
}

function openReviewDetail(id) {
  // eslint-disable-next-line eqeqeq
  const r = ALL_REVIEWS.find(x => x.id == id);
  if (!r) return;
  const date = r.created_at
    ? new Date(r.created_at).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric', hour:'2-digit', minute:'2-digit'})
    : '—';
  const ratingClass = r.rating >= 4 ? 'high' : r.rating === 3 ? 'mid' : 'low';

  document.getElementById('review-detail-body').innerHTML = `
    <div class="rd-customer-section">
      <div class="rd-avatar">${(r.customer_name||'?').charAt(0).toUpperCase()}</div>
      <div class="rd-customer-info">
        <div class="rd-customer-name">${r.customer_name}</div>
        <div class="rd-customer-email">${r.customer_email || '—'}</div>
        <div class="rd-customer-date">Reviewed on ${date}</div>
      </div>
    </div>
    <div class="rd-divider"></div>
    <div class="rd-product-row">
      <span class="review-product-tag" style="margin:0">${r.product_name || 'Unknown Product'}</span>
      <div class="rd-stars-row">${starsHTML(r.rating, 'md')} <span class="rd-rating-label ${ratingClass}-rating">${r.rating}/5</span></div>
    </div>
    <div class="rd-review-text">"${r.review_text || ''}"</div>`;

  document.getElementById('review-detail-modal').classList.add('open');
}

function closeReviewDetailModal() {
  document.getElementById('review-detail-modal').classList.remove('open');
}

function openReviewReply(id) {
  // eslint-disable-next-line eqeqeq
  const r = ALL_REVIEWS.find(x => x.id == id);
  if (!r) return;
  reviewReplyTarget = id;

  const dateStr = r.created_at
    ? new Date(r.created_at).toLocaleDateString('en-PH', {month:'short', day:'numeric', year:'numeric'})
    : '\u2014';

  const modalEl = document.getElementById('review-reply-modal');
  const cardEl  = document.getElementById('rr-review-card');
  const textEl  = document.getElementById('rr-reply-text');

  if (!modalEl || !cardEl || !textEl) {
    injectReviewModals();
    setTimeout(() => openReviewReply(id), 50);
    return;
  }

  cardEl.innerHTML = `
    <div class="rr-stars">${starsHTML(r.rating)}</div>
    <div class="rr-product">${r.product_name || 'Unknown Product'}</div>
    <div class="rr-customer">${r.customer_name || 'Customer'} \u00b7 ${dateStr}</div>
    <p class="rr-text">"${r.review_text || ''}"</p>`;

  textEl.value = r.admin_reply || '';
  modalEl.classList.add('open');
}

function closeReviewReplyModal() {
  document.getElementById('review-reply-modal').classList.remove('open');
  reviewReplyTarget = null;
}

async function saveReviewReply() {
  const text = document.getElementById('rr-reply-text').value.trim();
  if (!text) { showToast('Reply cannot be empty', 'err'); return; }
  // eslint-disable-next-line eqeqeq
  const r = ALL_REVIEWS.find(x => x.id == reviewReplyTarget);
  if (!r) return;
  r.admin_reply = text;
  r.replied_at  = new Date().toISOString();
  try { await db.from('reviews').update({ admin_reply: text, replied_at: r.replied_at }).eq('id', reviewReplyTarget); } catch(e) { console.error('saveReviewReply DB error:', e); }
  closeReviewReplyModal();
  renderReviews();
  showToast('Reply posted!');
}

// ══════════════════════════════════════════════════════════
//  PAYMENT MANAGEMENT PAGE
//
//  Supabase schema — run this SQL in your Supabase SQL editor:
//  ─────────────────────────────────────────────────────────
//  -- 1. Payments / transactions table
//  create table if not exists payments (
//    id            bigint generated always as identity primary key,
//    order_id      text        not null references orders(id) on delete cascade,
//    customer_name text,
//    method        text        not null,           -- cod | gcash | maya | card
//    amount        numeric     not null default 0,
//    status        text        not null default 'pending', -- paid | pending | failed | refunded
//    reference_no  text,                           -- GCash/Maya/card ref number; null for COD
//    created_at    timestamptz not null default now()
//  );
//  create index if not exists payments_order_id_idx on payments(order_id);
//  create index if not exists payments_status_idx   on payments(status);
//  alter table payments enable row level security;
//  create policy "Admin full access" on payments for all using (true);
//
//  -- 2. Enabled payment methods (replaces store_settings)
//  create table if not exists payment_methods (
//    id         text primary key,                  -- cod | gcash | maya | card
//    enabled    boolean not null default true,
//    updated_at timestamptz default now()
//  );
//  -- Seed default rows
//  insert into payment_methods (id, enabled) values
//    ('cod',   true),
//    ('gcash', true),
//    ('maya',  true),
//    ('card',  true)
//  on conflict (id) do nothing;
//  alter table payment_methods enable row level security;
//  create policy "Admin full access" on payment_methods for all using (true);
// ══════════════════════════════════════════════════════════

const PAYMENT_METHODS = [
  { id: 'cod',   name: 'Cash on Delivery',    desc: 'Customer pays in cash upon delivery' },
  { id: 'gcash', name: 'GCash',               desc: 'Mobile wallet via GCash' },
  { id: 'maya',  name: 'Maya',                desc: 'Mobile wallet via Maya (PayMaya)' },
  { id: 'card',  name: 'Credit / Debit Card', desc: 'Visa, Mastercard, and other cards' },
];

let enabledPayments  = ['cod', 'gcash', 'maya', 'card']; // fallback defaults
let paymentSaveTimer = null;
let ALL_TRANSACTIONS = [];
let pmFilterMethod   = 'all';
let pmFilterStatus   = 'all';

// ── 1. Load enabled methods from payment_methods table ──
async function loadPaymentSettings() {
  try {
    const { data, error } = await db
      .from('payment_methods')
      .select('id, enabled');
    if (error) throw error;
    if (data && data.length) {
      enabledPayments = data.filter(r => r.enabled).map(r => r.id);
    }
  } catch(e) {
    console.warn('payment_methods table not found — using defaults. Run the schema SQL above.');
  }
}

// ── 2. Save a single method toggle to payment_methods ──
async function savePaymentMethodToggle(id, enabled) {
  const indicator = document.getElementById('payment-saving-indicator');
  if (indicator) indicator.textContent = 'Saving...';
  try {
    const { error } = await db
      .from('payment_methods')
      .upsert({ id, enabled, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) throw error;
    if (indicator) {
      indicator.textContent = 'Saved.';
      setTimeout(() => { if (indicator) indicator.textContent = ''; }, 2000);
    }
  } catch(e) {
    console.error('savePaymentMethodToggle:', e);
    if (indicator) indicator.textContent = 'Save failed — create payment_methods table first (see schema above).';
  }
}

// ── 3. Load all transactions from payments table ──
async function loadTransactions() {
  // ── Pull from payments table ──
  let paymentsRows = [];
  try {
    const { data, error } = await db
      .from('payments')
      .select('id, order_id, customer_name, method, amount, status, reference_no, created_at')
      .order('created_at', { ascending: false });
    if (!error) paymentsRows = data || [];
  } catch(e) {
    console.warn('payments table not found — run the schema SQL above.');
  }

  // ── Build synthetic transactions from existing orders ──
  // Deduplicate: skip orders that already have a row in payments table
  const coveredOrderIds = new Set(paymentsRows.map(p => p.order_id));

  const orderRows = ORDERS
    .filter(o => !coveredOrderIds.has(o.id))
    .map(o => ({
      id:            'ord-' + o.id,
      order_id:      o.id,
      customer_name: o.customer || '—',
      method:        (o.payment || 'cod').toLowerCase(),
      amount:        o.total || 0,
      status: o.status === 'delivered'                                         ? 'paid'
            : o.status === 'cancelled'                                         ? 'failed'
            : (o.status === 'shipped' || o.status === 'out_for_delivery')      ? 'pending'
            : o.status === 'processing'                                        ? 'pending'
            : 'pending',
      reference_no:  null,
      created_at:    o.date || null,
      _fromOrder:    true,
    }));

  // Merge: real payments rows first, then order-derived rows; sort newest first
  ALL_TRANSACTIONS = [
    ...paymentsRows,
    ...orderRows,
  ].sort((a, b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
}

// ── 4. Render the full Payments page ──
async function renderPaymentSettings() {
  // Load both in parallel
  await Promise.all([loadPaymentSettings(), loadTransactions()]);

  renderPaymentToggles();
  renderPaymentBreakdown();
  renderPaymentStats();
  renderTransactions();
}

function renderPaymentToggles() {
  const list = document.getElementById('payment-method-list');
  if (!list) return;
  const isOwner = can('manage_all');
  const noteEl  = document.getElementById('payment-owner-note');
  if (noteEl) noteEl.style.display = isOwner ? 'none' : 'inline';

  list.innerHTML = PAYMENT_METHODS.map(m => {
    const on = enabledPayments.includes(m.id);
    return `
    <div class="payment-method-row">
      <div class="payment-method-info">
        <div class="payment-method-name">${m.name}</div>
        <div class="payment-method-desc">${m.desc}</div>
        <div class="payment-method-status ${on ? 'enabled' : 'disabled'}" id="pm-status-${m.id}">${on ? 'Enabled' : 'Disabled'}</div>
      </div>
      <label class="toggle-switch">
        <input type="checkbox" id="pm-toggle-${m.id}" ${on ? 'checked' : ''} ${isOwner ? '' : 'disabled'}
          onchange="togglePaymentMethod('${m.id}', this.checked)">
        <span class="toggle-track"></span>
      </label>
    </div>`;
  }).join('');
}

function renderPaymentBreakdown() {
  const el = document.getElementById('pm-breakdown-chart');
  if (!el) return;
  if (!ALL_TRANSACTIONS.length) {
    el.innerHTML = '<div style="color:var(--text3);font-family:var(--mono);font-size:12px">No transactions yet.</div>';
    return;
  }
  const paid = ALL_TRANSACTIONS.filter(t => t.status === 'paid');
  const pmTotals = {};
  paid.forEach(t => {
    const key = (t.method || 'unknown').toLowerCase();
    if (!pmTotals[key]) pmTotals[key] = { count: 0, revenue: 0 };
    pmTotals[key].count++;
    pmTotals[key].revenue += Number(t.amount) || 0;
  });
  const sorted = Object.entries(pmTotals).sort((a, b) => b[1].revenue - a[1].revenue);
  const maxRev = Math.max(...sorted.map(x => x[1].revenue), 1);
  const colors = ['', 'info', 'warn', '', 'info'];
  el.innerHTML = sorted.map(([id, stats], i) => {
    const method = PAYMENT_METHODS.find(m => m.id === id) || { name: id.toUpperCase() };
    const pct    = Math.round((stats.revenue / maxRev) * 100);
    return `
    <div class="bar-row">
      <span class="bar-label">${method.name}</span>
      <div class="bar-track"><div class="bar-fill ${colors[i % colors.length]}" style="width:${pct}%"></div></div>
      <span class="bar-value" style="min-width:140px;text-align:right">
        ₱${stats.revenue.toLocaleString('en-PH')} · ${stats.count} txn${stats.count !== 1 ? 's' : ''}
      </span>
    </div>`;
  }).join('');
}

function renderPaymentStats() {
  const paid     = ALL_TRANSACTIONS.filter(t => t.status === 'paid');
  const pending  = ALL_TRANSACTIONS.filter(t => t.status === 'pending');
  const failed   = ALL_TRANSACTIONS.filter(t => t.status === 'failed');
  const total    = paid.reduce((s, t) => s + (Number(t.amount) || 0), 0);
  const set = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
  set('pm-stat-total',   '₱' + total.toLocaleString('en-PH'));
  set('pm-stat-count',   ALL_TRANSACTIONS.length);
  set('pm-stat-pending', pending.length);
  set('pm-stat-failed',  failed.length);
}

function filterPaymentTxns() {
  pmFilterMethod = document.getElementById('pm-filter-method')?.value || 'all';
  pmFilterStatus = document.getElementById('pm-filter-status')?.value || 'all';
  renderTransactions();
}

function renderTransactions() {
  const tbody = document.getElementById('payments-tbody');
  if (!tbody) return;

  let list = [...ALL_TRANSACTIONS];
  if (pmFilterMethod !== 'all') list = list.filter(t => (t.method||'').toLowerCase() === pmFilterMethod);
  if (pmFilterStatus !== 'all') list = list.filter(t => (t.status||'').toLowerCase() === pmFilterStatus);

  if (!list.length) {
    tbody.innerHTML = `<tr><td colspan="8"><div class="empty-state"><p>${ALL_TRANSACTIONS.length ? 'No transactions match your filters.' : 'No transactions yet. They will appear here once orders are paid.'}</p></div></td></tr>`;
    return;
  }

  const statusBadge = s => {
    const map = { paid:'in-stock', pending:'processing', failed:'cancelled', refunded:'shipped' };
    return `<span class="badge ${map[s]||''}">${s.charAt(0).toUpperCase()+s.slice(1)}</span>`;
  };

  tbody.innerHTML = list.map(t => {
    const method   = PAYMENT_METHODS.find(m => m.id === (t.method||'').toLowerCase()) || { name: (t.method||'—').toUpperCase() };
    const date     = t.created_at ? new Date(t.created_at).toLocaleString('en-PH',{year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'}) : '—';
    const idCell   = t._fromOrder
      ? `<span class="text-xs-muted text-mono" title="Derived from order">— <span style="font-size:10px;color:var(--text3)">(order)</span></span>`
      : `<span class="text-mono text-xs-muted">#${t.id}</span>`;
    const refCell  = t.reference_no
      ? `<span class="text-mono text-xs-muted">${t.reference_no}</span>`
      : `<span style="color:var(--text3)">—</span>`;
    return `
    <tr>
      <td>${idCell}</td>
      <td><span class="order-link" onclick="openOrder('${t.order_id}')">${t.order_id}</span></td>
      <td>${t.customer_name || '—'}</td>
      <td><span class="text-sm-muted">${method.name}</span></td>
      <td class="text-mono text-bold">₱${Number(t.amount).toLocaleString('en-PH')}</td>
      <td>${statusBadge(t.status || 'pending')}</td>
      <td>${refCell}</td>
      <td class="text-xs-muted text-mono">${date}</td>
    </tr>`;
  }).join('');
}

function togglePaymentMethod(id, enabled) {
  if (!can('manage_all')) {
    showToast('Owner role required to manage payment methods', 'err');
    const cb = document.getElementById(`pm-toggle-${id}`);
    if (cb) cb.checked = !enabled;
    return;
  }

  if (enabled) {
    if (!enabledPayments.includes(id)) enabledPayments.push(id);
  } else {
    if (enabledPayments.length <= 1) {
      showToast('At least one payment method must remain enabled', 'err');
      const cb = document.getElementById(`pm-toggle-${id}`);
      if (cb) cb.checked = true;
      return;
    }
    enabledPayments = enabledPayments.filter(x => x !== id);
  }

  // Update status label inline
  const statusEl = document.getElementById(`pm-status-${id}`);
  if (statusEl) {
    statusEl.textContent = enabled ? 'Enabled' : 'Disabled';
    statusEl.className   = `payment-method-status ${enabled ? 'enabled' : 'disabled'}`;
  }

  // Debounce — avoid hammering Supabase on rapid toggles
  clearTimeout(paymentSaveTimer);
  paymentSaveTimer = setTimeout(() => savePaymentMethodToggle(id, enabled), 600);
}

// ── TOAST ──
function showToast(msg, type = '') {
  const container = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-item' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => el.remove(), 3000);
}

// ── CLOSE MODAL ON OVERLAY CLICK (delegated — works for all modals) ──
document.addEventListener('click', e => {
  if (e.target.classList.contains('modal-overlay')) {
    e.target.classList.remove('open');
  }
});


// ══════════════════════════════════════════════════════════
//  REVIEW MODALS — injected at runtime (no HTML edit needed)
// ══════════════════════════════════════════════════════════
function injectReviewModals() {
  // review-detail-modal already exists in HTML — only inject the reply modal
  if (document.getElementById('review-reply-modal')) return; // already injected

  const html = `
  <!-- Review Reply Modal -->
  <div class="modal-overlay" id="review-reply-modal">
    <div class="modal modal-narrow" style="background:var(--surface);border:1px solid var(--border2);border-radius:12px;padding:28px;position:relative;">
      <button class="modal-close" onclick="closeReviewReplyModal()">✕</button>
      <div class="modal-title">Reply to Review</div>
      <p style="font-size:12px;color:var(--text3);margin:0 0 16px;">Your reply will be visible to the customer on their review.</p>
      <div id="rr-review-card" style="background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:14px;margin-bottom:16px;font-size:13px;color:var(--text2);"></div>
      <label style="font-size:11px;font-weight:600;color:var(--text3);display:block;margin-bottom:6px;text-transform:uppercase;letter-spacing:0.06em;">YOUR REPLY</label>
      <textarea id="rr-reply-text" rows="4" placeholder="Write a helpful, professional reply..." style="width:100%;box-sizing:border-box;background:var(--surface2);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:13px;font-family:inherit;resize:vertical;outline:none;"></textarea>
      <div class="modal-footer">
        <button class="btn btn-ghost" onclick="closeReviewReplyModal()">Cancel</button>
        <button class="btn btn-primary" onclick="saveReviewReply()">Post Reply</button>
      </div>
    </div>
  </div>`;

  document.body.insertAdjacentHTML('beforeend', html);

  // Modal overlay click-to-close (reply modal only; detail modal handled by delegated listener)
  document.getElementById('review-reply-modal').addEventListener('click', function(e) {
    if (e.target === this) this.classList.remove('open');
  });
}

// ══════════════════════════════════════════════════════════
//  INIT
// ══════════════════════════════════════════════════════════
async function initAdmin() {
  await Promise.all([loadOrders(), loadProducts(), loadPaymentSettings(), loadReviews()]);
  renderDashOrders();
  renderRevChart();
  renderDashboardStats();
  renderOrders(filteredOrders);
  renderProducts();
  renderInventory();
  await renderCustomersFromOrders();
  renderReviewSummary();
  updateBadges();
  renderSyncStatus();
  injectReviewModals();
  startRealtimeSync();
}

// initAdmin() is called by loginSubmit() after successful login
// ══════════════════════════════════════════════════════════
//  SESSION PERSISTENCE — Restore login on page refresh
//  Saves role to sessionStorage on login/switch
//  Clears on sign out (tab close also clears automatically)
// ══════════════════════════════════════════════════════════

function signOut() {
  sessionStorage.removeItem('cc_role');
  sessionStorage.removeItem('cc_username');
  CURRENT_ROLE = null;
  document.body.classList.remove('rbac-ready');
  document.getElementById('login-screen').classList.remove('hidden');

  // Reset login form
  loginSelectedRole = null;
  document.querySelectorAll('.login-box .role-btn').forEach(b => b.classList.remove('selected'));
  document.getElementById('login-creds-section').classList.remove('visible');
  const u = document.getElementById('login-username');
  const p = document.getElementById('login-password');
  if (u) u.value = '';
  if (p) p.value = '';
  document.getElementById('login-pin-hint').textContent = '';

  showToast('Signed out successfully');
}

async function restoreSession() {
  const savedRole     = sessionStorage.getItem('cc_role');
  const savedUsername = sessionStorage.getItem('cc_username');

  if (!savedRole || !savedUsername) return; // No saved session, show login

  // Verify the saved role still exists in admin_roles
  try {
    const { data, error } = await db
      .from('admin_roles')
      .select('role')
      .eq('role', savedRole)
      .eq('username', savedUsername.toLowerCase())
      .single();

    if (error || !data) {
      // Session invalid, clear and show login
      sessionStorage.removeItem('cc_role');
      sessionStorage.removeItem('cc_username');
      return;
    }

    // Session valid — restore without re-entering password
    CURRENT_ROLE = savedRole;
    document.body.classList.add('rbac-ready');
    document.getElementById('login-screen').classList.add('hidden');
    applyRoleUI();
    initAdmin();

  } catch (e) {
    console.error('restoreSession error:', e);
  }
}

// Run on every page load
restoreSession();
// ── Inject review card styles (added for post-delivery review reflection) ──
(function injectReviewCardStyles() {
  const style = document.createElement('style');
  style.textContent = `
    .review-card-footer {
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 8px;
      margin-top: 12px;
      padding-top: 10px;
      border-top: 1px solid var(--border, #2a2a3a);
    }
    .rev-badges {
      display: flex;
      align-items: center;
      gap: 6px;
      flex-wrap: wrap;
    }
    .rev-replied-badge {
      font-size: 11px;
      font-weight: 600;
      color: #4ade80;
      background: rgba(74,222,128,.1);
      border: 1px solid rgba(74,222,128,.25);
      border-radius: 20px;
      padding: 2px 8px;
    }
    .rev-admin-reply {
      background: rgba(123,94,167,.12);
      border-left: 3px solid var(--accent2, #7b5ea7);
      border-radius: 0 6px 6px 0;
      padding: 8px 12px;
      font-size: 12px;
      color: var(--text2, #ccc);
      margin-top: 8px;
      font-style: italic;
    }
    .rev-reply-label {
      font-style: normal;
      font-weight: 600;
      color: var(--accent2, #7b5ea7);
      margin-right: 4px;
    }
    .btn-warn {
      background: rgba(251,191,36,.15);
      border: 1px solid var(--warn, #fbbf24);
      color: var(--warn, #fbbf24);
      border-radius: 6px;
      cursor: pointer;
      font-size: 11px;
      padding: 4px 10px;
      font-family: inherit;
      transition: .15s;
    }
    .btn-warn:hover { background: rgba(251,191,36,.28); }
  `;
  document.head.appendChild(style);
})();