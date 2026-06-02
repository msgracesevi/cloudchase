// ════════════════════════════════════════════════════════
//  CLOUDCHASE RIDER — Supabase Edition (no hardcoded data)
//  Requires: supabase-config.js loaded first
//  localStorage: cc_rider_session (device-local profile only)
//  Delivery history & earnings → Supabase `rider_deliveries` table
// ════════════════════════════════════════════════════════

const LS_RIDER = 'cc_rider_session';

// ── RIDER STATE ──
let rider               = JSON.parse(localStorage.getItem(LS_RIDER) || 'null');
let isOnline            = true;
let activeDeliveries    = [];   // array of active deliveries (multi-order support)
let completedDeliveries = [];   // populated from Supabase on boot
let currentSheetOrder   = null;
let deliverySteps       = {};   // map: orderId → step (0-3)
let proofPhotos         = {};   // map: orderId → base64 data URL
let minimizedCards      = {};   // map: orderId → boolean (kept for compat)
let activeDeliveryTabId = null;  // which delivery is shown in the active panel

// legacy compat shim — some internals still reference activeDelivery
Object.defineProperty(window, 'activeDelivery', {
  get() { return activeDeliveries[0] || null; },
  set(v) { /* no-op, use activeDeliveries directly */ }
});

// ── LOGIN ──
async function riderLogin() {
  const phone = document.getElementById('rider-phone').value.trim();
  const plate = document.getElementById('rider-plate').value.trim().toUpperCase();
  const pin   = document.getElementById('rider-pin').value.trim();

  if (!phone) { showToast('Please enter your phone number', 'error'); return; }
  if (!plate) { showToast('Please enter your plate / vehicle', 'error'); return; }
  if (!pin)   { showToast('Please enter your PIN', 'error'); return; }

  const btn = document.querySelector('#login-screen .btn-primary');
  btn.textContent = 'Verifying…';
  btn.disabled = true;

  // Fetch all riders — no filter, we match client-side to avoid any DB formatting issues
  const { data, error } = await db
    .from('riders')
    .select('*');

  btn.textContent = 'Start Shift →';
  btn.disabled = false;

  if (error) {
    console.error('Login DB error:', error);
    showToast('Login error: ' + (error.message || 'Unknown'), 'error');
    return;
  }

  console.log('All riders from DB:', data);
  console.log('Trying to match — phone:', phone, '| plate:', plate, '| pin:', pin);

  const match = (data || []).find(r => {
    const dbPhone = (r.phone || '').trim();
    const dbPlate = (r.plate || '').trim().toUpperCase();
    const dbPin   = (r.pin   || '').trim();
    console.log('Checking rider:', r.name, '| phone:', dbPhone, '| plate:', dbPlate, '| pin:', dbPin);
    return dbPhone === phone && dbPlate === plate && dbPin === pin;
  });

  if (!match) {
    showToast('Credentials do not match. Check your details and PIN.', 'error');
    document.getElementById('rider-pin').value = '';
    return;
  }

  rider = {
    id:    match.id,
    name:  match.name,
    phone: match.phone,
    plate: match.plate,
    since: match.since || new Date().toISOString(),
  };

  localStorage.setItem(LS_RIDER, JSON.stringify(rider));
  await bootApp();
}

// ══════════════════════════════════════════════════════════
//  BOOT — called after login or on page-load auto-login
// ══════════════════════════════════════════════════════════
async function bootApp() {
  // ── Swap screens (screens are shown via .active, not .hidden) ──
  document.getElementById('login-screen').classList.remove('active');
  document.getElementById('app-screen').classList.add('active');

  // ── Populate rider info in the header ──
  const nameEl   = document.getElementById('rider-name-display');
  const avatarEl = document.getElementById('rider-avatar');
  if (nameEl)   nameEl.textContent   = rider.name;
  if (avatarEl) avatarEl.textContent = (rider.name || 'R')[0].toUpperCase();

  // ── Reset to online state ──
  isOnline = true;
  const statusLabel = document.getElementById('rider-status-label');
  const toggleBtn   = document.getElementById('toggle-btn');
  if (statusLabel) { statusLabel.textContent = '● ONLINE'; statusLabel.classList.remove('offline'); }
  if (toggleBtn)   toggleBtn.textContent = 'Go Offline';

  // ── Fetch data from Supabase in parallel ──
  await Promise.all([
    restoreActiveDelivery(),
    loadCompletedDeliveries(),
  ]);

  // ── Register / update rider presence ──
  await registerRiderInDB();

  // ── Render all panels ──
  renderActive();
  renderHistory();
  renderEarnings();
  await refreshQueue();
  updateEarningsChip();

  // ── Start real-time order sync + heartbeat ──
  startRealtimeSync();
}

// ══════════════════════════════════════════════════════════
//  LOGOUT
// ══════════════════════════════════════════════════════════
async function riderLogout() {
  if (!confirm('End your shift and sign out?')) return;

  // Mark offline in DB before clearing local state
  if (rider) await setOnlineInDB(false).catch(() => {});

  // Tear down realtime subscriptions + heartbeat
  await db.removeAllChannels().catch(() => {});

  // Clear local state
  rider               = null;
  isOnline            = true;
  activeDeliveries    = [];
  completedDeliveries = [];
  deliverySteps       = {};
  proofPhotos         = {};
  minimizedCards      = {};
  localStorage.removeItem(LS_RIDER);

  // Reset login form
  ['rider-phone', 'rider-plate', 'rider-pin'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  // Swap screens back to login
  document.getElementById('app-screen').classList.remove('active');
  document.getElementById('login-screen').classList.add('active');
}

// ══════════════════════════════════════════════════════════
//  RIDER REGISTRY — Supabase `riders` table
// ══════════════════════════════════════════════════════════
async function registerRiderInDB() {
  if (!rider) return;
  const entry = {
    id:               rider.id,
    name:             rider.name,
    phone:            rider.phone,
    plate:            rider.plate,
    online:           isOnline,
    current_order_id: activeDeliveries.length > 0 ? activeDeliveries[0].id : null,
    last_seen:        new Date().toISOString(),
    since:            rider.since,
  };
  const { error } = await db.from('riders').upsert(entry);
  if (error) console.error('registerRiderInDB:', error);
}

async function setOnlineInDB(online) {
  if (!rider) return;
  await db.from('riders').update({ online, last_seen: new Date().toISOString() }).eq('id', rider.id);
}

async function setRiderOrderInDB(orderId) {
  if (!rider) return;
  await db.from('riders').update({ current_order_id: orderId, last_seen: new Date().toISOString() }).eq('id', rider.id);
}

// ══════════════════════════════════════════════════════════
//  DELIVERY HISTORY — Supabase `rider_deliveries` table
//  Schema: id (uuid/serial), rider_id, order_id, order_data (jsonb),
//          rider_earning, completed_at
// ══════════════════════════════════════════════════════════
async function loadCompletedDeliveries() {
  if (!rider) return;
  const { data, error } = await db
    .from('rider_deliveries')
    .select('*')
    .eq('rider_id', rider.id)
    .order('completed_at', { ascending: false });

  if (error) { console.error('loadCompletedDeliveries:', error); return; }

  completedDeliveries = (data || []).map(row => ({
    ...(row.order_data || {}),
    id:           row.order_id,
    completedAt:  row.completed_at,
    riderEarning: row.rider_earning || DELIVERY_FEE,
  }));
}

async function saveDeliveryRecord(order, earning) {
  if (!rider) return;
  const record = {
    rider_id:     rider.id,
    order_id:     order.id,
    order_data:   order,
    rider_earning: earning,
    completed_at:  new Date().toISOString(),
  };
  const { error } = await db.from('rider_deliveries').insert(record);
  if (error) console.error('saveDeliveryRecord:', error);
}

// ── Restore active deliveries on page refresh ──
async function restoreActiveDelivery() {
  if (!rider) return;
  const { data: rows, error } = await db
    .from('orders')
    .select('*')
    .eq('rider_id', rider.id)
    .not('status', 'in', '(delivered,cancelled)');

  if (error || !rows) return;

  activeDeliveries = rows.map(order => ({ ...order, shipping: order.shipping || {} }));
  const stepMap = { 'accepted': 0, 'picked_up': 1, 'on_the_way': 2 };
  rows.forEach(order => {
    deliverySteps[order.id] = stepMap[order.rider_step] ?? 0;
  });
}

// ══════════════════════════════════════════════════════════
//  ORDER HELPERS — Supabase
// ══════════════════════════════════════════════════════════
async function getShopOrders() {
  const { data, error } = await db.from('orders').select('*').order('date', { ascending: false });
  if (error) { console.error('getShopOrders:', error); return []; }
  return data || [];
}

async function getQueueOrders() {
  const activeIds    = activeDeliveries.map(d => d.id);
  const completedIds = completedDeliveries.map(c => c.id);

  const { data, error } = await db.from('orders').select('*')
    .in('status', ['processing', 'shipped'])
    .is('rider_id', null);

  if (error) { console.error('getQueueOrders:', error); return []; }
  return (data || []).filter(o => !activeIds.includes(o.id) && !completedIds.includes(o.id));
}

// ══════════════════════════════════════════════════════════
//  QUEUE UI
// ══════════════════════════════════════════════════════════
async function refreshQueue() {
  const list          = document.getElementById('queue-list');
  const empty         = document.getElementById('queue-empty');
  const offlineNotice = document.getElementById('offline-notice');
  const badge         = document.getElementById('queue-badge');

  if (!isOnline) {
    list.innerHTML = '';
    offlineNotice.classList.remove('hidden');
    empty.classList.add('hidden');
    badge.classList.remove('show');
    return;
  }

  offlineNotice.classList.add('hidden');
  const orders = await getQueueOrders();

  if (orders.length > 0) { badge.textContent = orders.length; badge.classList.add('show'); }
  else badge.classList.remove('show');

  if (!orders.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }

  empty.classList.add('hidden');
  list.innerHTML = orders.map(o => buildOrderCard(o)).join('');
}

function buildOrderCard(o) {
  const shipping  = o.shipping || {};
  const fullName  = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || 'Customer';
  const address   = [shipping.address, shipping.city].filter(Boolean).join(', ') || '—';
  const payment   = (o.payment || 'cod').toUpperCase();
  const time      = o.date ? formatTime(o.date) : '—';
  const isCod     = payment === 'COD';

  const itemsHTML = (o.items || []).slice(0, 4).map(it =>
    `<span class="item-tag"><span class="qty">×${it.qty}</span> ${it.name}</span>`
  ).join('') + (o.items && o.items.length > 4 ? `<span class="item-tag">+${o.items.length - 4} more</span>` : '');

  return `
  <div class="order-card" id="card-${o.id}">
    <div class="order-card-header">
      <div class="order-id-row">
        <span class="order-card-id">#${o.id}</span>
        <span class="order-time-badge">${time}</span>
      </div>
      <span class="status-pill ${o.status}">${capitalize(o.status)}</span>
    </div>
    <div class="order-card-body">
      <div class="order-address">
        <span class="addr-icon">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
        </span>
        <div>
          <div class="addr-name">${fullName}</div>
          <div class="addr-text">${address}</div>
        </div>
      </div>
      <div class="order-meta">
        <div class="order-meta-item"><span class="icon">💰</span><span class="val">₱${(o.total||0).toLocaleString()}</span></div>
        <div class="order-meta-item"><span class="icon">📦</span><span class="val">${(o.items||[]).length} item${(o.items||[]).length !== 1 ? 's' : ''}</span></div>
        <div class="order-meta-item">${isCod ? `<span class="cod-badge">COD</span>` : `<span class="gcash-badge">${payment}</span>`}</div>
      </div>
    </div>
    <div class="order-card-items">${itemsHTML}</div>
    <div class="order-card-footer">
      <div>
        <div class="order-total">₱${(o.total||0).toLocaleString()}</div>
        <div class="order-pay-method">${isCod ? '⚠ Collect cash on delivery' : '✓ Pre-paid'}</div>
      </div>
      <div class="card-actions">
        <button class="btn btn-ghost btn-sm" onclick="openOrderSheet('${o.id}')">Details</button>
        <button class="btn btn-primary btn-sm" onclick="acceptOrder('${o.id}')">Accept →</button>
      </div>
    </div>
  </div>`;
}

// ══════════════════════════════════════════════════════════
//  ACCEPT ORDER — atomic claim via Supabase
// ══════════════════════════════════════════════════════════
async function acceptOrder(orderId) {
  const { data: order, error } = await db.from('orders').select('*').eq('id', orderId).single();
  if (error || !order) { showToast('Order not found', 'error'); return; }

  if (order.rider_id) {
    showToast('Order was just claimed by another rider', 'warn');
    refreshQueue();
    return;
  }

  const { data: claimed, error: claimErr } = await db
    .from('orders')
    .update({
      rider_id:          rider.id,
      rider_name:        rider.name,
      rider_phone:       rider.phone,
      rider_plate:       rider.plate,
      rider_accepted_at: new Date().toISOString(),
      rider_step:        'accepted',
      status:            'out_for_delivery',
    })
    .eq('id', orderId)
    .is('rider_id', null)
    .select()
    .single();

  if (claimErr || !claimed) {
    showToast('Order was just claimed by another rider', 'warn');
    refreshQueue();
    return;
  }

  const newDelivery = { ...claimed, shipping: claimed.shipping || {}, acceptedAt: new Date().toISOString() };
  activeDeliveries.push(newDelivery);
  deliverySteps[orderId] = 0;
  activeDeliveryTabId = orderId;   // focus the new delivery immediately

  await registerRiderInDB();

  closeSheet();
  switchTab('active');
  refreshQueue();
  renderActive();
  showToast(`Order #${orderId} accepted! 🛵`, 'success');
}

// ══════════════════════════════════════════════════════════
//  ACTIVE DELIVERY RENDERING — tabbed single-card view
// ══════════════════════════════════════════════════════════
function switchDeliveryTab(orderId) {
  activeDeliveryTabId = orderId;
  renderActive();
}

function renderActive() {
  const wrap     = document.getElementById('active-delivery-wrap');
  const noActive = document.getElementById('no-active');
  const tabBtn   = document.getElementById('tab-active');
  const countEl  = document.getElementById('active-count');

  if (!activeDeliveries.length) {
    wrap.innerHTML = '';
    noActive.classList.remove('hidden');
    tabBtn.querySelector('svg').style.stroke = '';
    if (countEl) countEl.textContent = '0 active';
    const oldBadge = tabBtn.querySelector('.active-count-badge');
    if (oldBadge) oldBadge.remove();
    activeDeliveryTabId = null;
    return;
  }

  noActive.classList.add('hidden');
  if (countEl) countEl.textContent = `${activeDeliveries.length} active`;

  // Pill badge on the main tab bar
  const oldBadge = tabBtn.querySelector('.active-count-badge');
  if (oldBadge) oldBadge.remove();
  if (activeDeliveries.length > 1) {
    const badge = document.createElement('span');
    badge.className = 'tab-badge active-count-badge show';
    badge.style.cssText = 'background:var(--accent);color:#000';
    badge.textContent = activeDeliveries.length;
    tabBtn.appendChild(badge);
  }

  // Make sure selected tab is still valid
  if (!activeDeliveryTabId || !activeDeliveries.find(d => d.id === activeDeliveryTabId)) {
    activeDeliveryTabId = activeDeliveries[0].id;
  }

  const stepLabels = ['Accepted', 'Picked Up', 'On the Way', 'Delivered'];

  // ── Delivery switcher strip (only when >1 active) ──
  const stripHTML = activeDeliveries.length > 1 ? `
    <div style="display:flex;gap:6px;overflow-x:auto;padding:10px 12px 0;scrollbar-width:none;-webkit-overflow-scrolling:touch">
      ${activeDeliveries.map(o => {
        const step  = deliverySteps[o.id] ?? 0;
        const isSel = o.id === activeDeliveryTabId;
        const isCod = (o.payment || 'cod').toUpperCase() === 'COD';
        const shipping = o.shipping || {};
        const name = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || 'Customer';
        return `<button
          onclick="switchDeliveryTab('${o.id}')"
          style="flex-shrink:0;display:flex;flex-direction:column;align-items:flex-start;gap:3px;
                 padding:8px 12px;border-radius:10px;
                 border:1.5px solid ${isSel ? 'var(--accent)' : 'var(--border, #2a2a2e)'};
                 background:${isSel ? 'rgba(255,213,0,0.08)' : 'var(--card, #18181c)'};
                 cursor:pointer;min-width:108px;text-align:left">
          <span style="font-family:var(--mono);font-size:11px;font-weight:700;
                       color:${isSel ? 'var(--accent)' : 'var(--text)'}">
            #${o.id}
          </span>
          <span style="font-size:10px;font-family:var(--mono);letter-spacing:0.03em;
                       color:${isSel ? 'var(--text2, #aaa)' : 'var(--text3, #666)'}">
            ${stepLabels[step]}
          </span>
          <span style="font-size:10px;color:var(--text3, #666);white-space:nowrap;overflow:hidden;
                       text-overflow:ellipsis;max-width:90px">${name}</span>
          ${isCod ? `<span style="font-size:9px;color:var(--warn, #faad14);font-family:var(--mono)">COD</span>` : ''}
        </button>`;
      }).join('')}
    </div>` : '';

  const current = activeDeliveries.find(d => d.id === activeDeliveryTabId);
  wrap.innerHTML = stripHTML + (current ? buildActiveCard(current) : '');
}

function buildActiveCard(o) {
  const shipping  = o.shipping || {};
  const fullName  = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || 'Customer';
  const address   = [shipping.address, shipping.city].filter(Boolean).join(', ') || '—';
  const phone     = shipping.phone || '—';
  const payment   = (o.payment || 'cod').toUpperCase();
  const isCod     = payment === 'COD';
  const step      = deliverySteps[o.id] ?? 0;

  const steps     = ['Accepted', 'Picked Up', 'On the Way', 'Delivered'];
  const stepsHTML = steps.map((label, i) => {
    const isDone    = i < step;
    const isCurrent = i === step;
    const lineAfter = i < steps.length - 1;
    return `
      <div class="progress-step">
        <div class="step-dot ${isDone ? 'done' : isCurrent ? 'current' : ''}">
          ${isDone ? '✓' : i + 1}
        </div>
        <span class="step-label ${isDone ? 'done' : isCurrent ? 'current' : ''}">${label}</span>
      </div>
      ${lineAfter ? `<div class="progress-line ${isDone ? 'done' : ''}"></div>` : ''}
    `;
  }).join('');

  const itemsHTML = (o.items || []).map(it =>
    `<div class="active-item">
      <span class="active-item-name">${it.emoji || '📦'} ${it.name} ×${it.qty}</span>
      <span class="active-item-price">₱${(it.price * it.qty).toLocaleString()}</span>
    </div>`
  ).join('');

  const nextLabels = ['Confirm Pickup', 'Start Delivery', 'Mark Delivered'];
  const proof      = proofPhotos[o.id];

  // Proof section shown at step 2 (on the way) and step 3 (final confirm)
  const proofSection = step >= 2 ? `
    <div class="proof-section" id="proof-section-${o.id}">
      <div class="proof-label">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
        PHOTO PROOF OF DELIVERY
        ${step < 3 ? '' : '<span class="proof-required">required</span>'}
      </div>
      ${proof ? `
  <div class="proof-preview compact">
    <img src="${proof}"
         alt="Proof of delivery"
         onclick="viewProofPhoto('${o.id}')">

    <div class="proof-actions">
      <button class="btn btn-xs btn-outline"
              onclick="viewProofPhoto('${o.id}')">
        View
      </button>

      <button class="btn btn-xs btn-ghost"
              onclick="triggerPhotoInput('${o.id}')">
        Retake
      </button>
    </div>
  </div>` : `
        <button class="btn btn-outline btn-full proof-btn" onclick="triggerPhotoInput('${o.id}')">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
          Take / Upload Photo
        </button>`}
      <input type="file" accept="image/*" capture="environment"
             id="photo-input-${o.id}"
             style="display:none"
             onchange="handlePhotoCapture('${o.id}', this)">
    </div>` : '';

  const actionsHTML = step < 3
    ? `<button class="btn btn-primary btn-full" onclick="advanceStep('${o.id}')">${nextLabels[step]} →</button>`
    : `<button class="btn btn-primary btn-full" onclick="confirmDelivered('${o.id}')"
         ${!proof ? 'style="opacity:0.5"' : ''}>
         ✓ Confirm Delivered ${!proof ? '(photo required)' : ''}
       </button>`;

  // Clean card — no minimize toggle (tab strip handles switching)
  return `
  <div class="active-card" id="active-card-${o.id}" style="border-radius:${activeDeliveries.length > 1 ? '0 0 14px 14px' : '14px'};margin-top:0">
    <div style="display:flex;align-items:center;gap:8px;padding:10px 14px;border-bottom:1px solid var(--border, #2a2a2e)">
      <div class="active-pulse"></div>
      <span style="font-family:var(--mono);font-size:10px;font-weight:700;letter-spacing:0.08em;color:var(--accent)">ACTIVE</span>
      <span style="font-family:var(--mono);font-size:12px;color:var(--text2)">· #${o.id}</span>
      <span style="font-size:13px;font-weight:600;color:var(--text);margin-left:4px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${fullName}</span>
    </div>
    <div class="active-progress">
      <div class="progress-steps">${stepsHTML}</div>
    </div>
    <div class="active-info">
      <div class="active-info-row">
        <span class="ai-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></span>
        <div><div class="ai-label">CUSTOMER</div><div class="ai-val"><strong>${fullName}</strong></div></div>
      </div>
      <div class="active-info-row">
        <span class="ai-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></span>
        <div><div class="ai-label">DELIVER TO</div><div class="ai-val">${address}</div></div>
      </div>
      <div class="active-info-row">
        <span class="ai-icon"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07A19.5 19.5 0 0 1 4.69 9.86 19.79 19.79 0 0 1 1.61 1.2 2 2 0 0 1 3.6 0h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L7.91 8.1A16 16 0 0 0 16 16.09l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 24 17z"/></svg></span>
        <div><div class="ai-label">CONTACT</div><div class="ai-val">${phone}</div></div>
      </div>
      <div class="active-info-row">
        <span class="ai-icon">💳</span>
        <div>
          <div class="ai-label">PAYMENT</div>
          <div class="ai-val">
            ${isCod
              ? `<span class="cod-badge">COD</span> <span style="color:var(--warn);font-size:12px;margin-left:4px">Collect ₱${(o.total||0).toLocaleString()}</span>`
              : `<span class="gcash-badge">${payment}</span> <span style="color:var(--accent);font-size:12px;margin-left:4px">Pre-paid ✓</span>`}
          </div>
        </div>
      </div>
    </div>
    <div style="padding:4px 16px 6px; font-family:var(--mono); font-size:10px; letter-spacing:0.08em; color:var(--text3);">ORDER ITEMS</div>
    <div class="active-items-list">${itemsHTML}</div>
    <div class="active-total-row">
      <span class="at-label">TOTAL</span>
      <span class="at-val">₱${(o.total||0).toLocaleString()}</span>
    </div>
    ${proofSection}
    <div class="active-actions">
      ${actionsHTML}
      <button class="btn btn-outline btn-full" onclick="cancelActiveDelivery('${o.id}')">Cancel Delivery</button>
    </div>
  </div>`;
}

// ── Minimize shim kept for compat (no longer used in UI) ──
function toggleCardMinimize(orderId) {
  minimizedCards[orderId] = !minimizedCards[orderId];
  renderActive();
}

// ── Photo proof handlers ──
function triggerPhotoInput(orderId) {
  document.getElementById(`photo-input-${orderId}`)?.click();
}

function handlePhotoCapture(orderId, input) {
  const file = input.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = (e) => {
    proofPhotos[orderId] = e.target.result;
    renderActive();
    showToast('Photo captured ✓', 'success');
  };
  reader.readAsDataURL(file);
}

function viewProofPhoto(orderId) {
  const src = proofPhotos[orderId];
  if (!src) return;
  // Simple full-screen overlay
  const overlay = document.createElement('div');
  overlay.style.cssText = `position:fixed;inset:0;background:rgba(0,0,0,.92);z-index:9999;display:flex;align-items:center;justify-content:center;padding:16px;`;
  overlay.innerHTML = `<img src="${src}" style="max-width:100%;max-height:100%;border-radius:10px;object-fit:contain">`;
  overlay.onclick = () => overlay.remove();
  document.body.appendChild(overlay);
}

async function advanceStep(orderId) {
  const step = deliverySteps[orderId] ?? 0;
  if (step < 3) {
    const newStep = step + 1;
    deliverySteps[orderId] = newStep;
    const stepMap = { 1: 'picked_up', 2: 'on_the_way' };
    if (stepMap[newStep]) {
      await db.from('orders').update({ status: 'out_for_delivery', rider_step: stepMap[newStep] }).eq('id', orderId);
    }
    renderActive();
    const msgs = ['Pickup confirmed! 🏪', 'On the way! 🛵', 'Almost there! 📍'];
    showToast(msgs[newStep - 1] || '', 'success');
  }
}

// ── CONFIRM DELIVERED ──
async function confirmDelivered(orderId) {
  const proof = proofPhotos[orderId];
  if (!proof) { showToast('Please take a photo proof first 📷', 'warn'); return; }

  const o = activeDeliveries.find(d => d.id === orderId);
  if (!o) return;

  // Upload proof photo to Supabase Storage (graceful fallback if bucket absent)
  let proofUrl = null;
  try {
    const blob     = await fetch(proof).then(r => r.blob());
    const fileName = `${rider.id}/${orderId}-${Date.now()}.jpg`;
    const { data: uploadData, error: uploadErr } = await db.storage
      .from('delivery-proofs')
      .upload(fileName, blob, { contentType: 'image/jpeg', upsert: true });
    if (!uploadErr && uploadData) {
      const { data: urlData } = db.storage.from('delivery-proofs').getPublicUrl(fileName);
      proofUrl = urlData?.publicUrl || null;
    }
  } catch (e) { console.warn('Proof upload skipped:', e); }

  const { error: updateErr } = await db.from('orders').update({
    status:       'delivered',
    rider_step:   'delivered',
    delivered_at: new Date().toISOString(),
    proof_photo:  proofUrl,
  }).eq('id', orderId);

  if (updateErr) {
    showToast('Failed to confirm delivery. Try again.', 'error');
    console.error('confirmDelivered:', updateErr);
    return;
  }

  const earning   = calculateEarning(o.total);
  const completed = { ...o, completedAt: new Date().toISOString(), riderEarning: earning, proofUrl };

  await saveDeliveryRecord(completed, earning);

  completedDeliveries.unshift(completed);
  activeDeliveries = activeDeliveries.filter(d => d.id !== orderId);
  delete deliverySteps[orderId];
  delete proofPhotos[orderId];
  delete minimizedCards[orderId];
  // Focus next remaining delivery, or null if all done
  activeDeliveryTabId = activeDeliveries.length ? activeDeliveries[0].id : null;

  await registerRiderInDB();

  renderActive();
  renderHistory();
  renderEarnings();
  refreshQueue();
  updateEarningsChip();

  showToast(`Delivered! +₱${earning} earned 🎉`, 'success');
  if (activeDeliveries.length === 0) switchTab('history');
}

async function cancelActiveDelivery(orderId) {
  if (!confirm('Cancel this delivery?')) return;

  const o = activeDeliveries.find(d => d.id === orderId);
  if (o) {
    await db.from('orders').update({
      rider_id:          null,
      rider_name:        null,
      rider_phone:       null,
      rider_plate:       null,
      rider_accepted_at: null,
      rider_step:        null,
      status:            'processing',
    }).eq('id', orderId).eq('rider_id', rider.id);
  }

  activeDeliveries = activeDeliveries.filter(d => d.id !== orderId);
  delete deliverySteps[orderId];
  delete proofPhotos[orderId];
  delete minimizedCards[orderId];
  activeDeliveryTabId = activeDeliveries.length ? activeDeliveries[0].id : null;

  await registerRiderInDB();

  renderActive();
  refreshQueue();
  if (activeDeliveries.length === 0) switchTab('queue');
  showToast('Delivery cancelled — order returned to queue');
}

// ══════════════════════════════════════════════════════════
//  EARNINGS
// ══════════════════════════════════════════════════════════
const DELIVERY_FEE    = 50;
const BONUS_THRESHOLD = 1500;

function calculateEarning(orderTotal) {
  return DELIVERY_FEE + (orderTotal >= BONUS_THRESHOLD ? 10 : 0);
}

function renderHistory() {
  const list    = document.getElementById('history-list');
  const empty   = document.getElementById('history-empty');
  const countEl = document.getElementById('history-count');

  countEl.textContent = `${completedDeliveries.length} deliveries`;

  if (!completedDeliveries.length) { list.innerHTML = ''; empty.classList.remove('hidden'); return; }

  empty.classList.add('hidden');
  list.innerHTML = completedDeliveries.map(o => {
    const shipping = o.shipping || {};
    const fullName = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || 'Customer';
    const address  = [shipping.address, shipping.city].filter(Boolean).join(', ') || '—';
    const time     = o.completedAt ? formatTime(o.completedAt) : '—';
    const earning  = o.riderEarning || DELIVERY_FEE;
    return `
    <div class="history-card">
      <div class="history-row">
        <span class="history-id">#${o.id}</span>
        <span class="history-earn">+₱${earning}</span>
      </div>
      <div class="history-row" style="margin-bottom:0">
        <span style="font-size:13px;color:var(--text2)">${fullName} · ${address}</span>
        <span class="history-total">₱${(o.total||0).toLocaleString()}</span>
      </div>
      <div class="history-meta" style="margin-top:6px">
        <span>Delivered ${time}</span>
        <span>${(o.payment||'COD').toUpperCase()}</span>
        <span class="status-pill delivered" style="padding:1px 7px;font-size:10px">Delivered</span>
      </div>
    </div>`;
  }).join('');
}

function renderEarnings() {
  const todayStr = new Date().toDateString();
  const weekAgo  = new Date(); weekAgo.setDate(weekAgo.getDate() - 7);

  const todayD = completedDeliveries.filter(o => { try { return new Date(o.completedAt).toDateString() === todayStr; } catch(e) { return false; } });
  const weekD  = completedDeliveries.filter(o => { try { return new Date(o.completedAt) >= weekAgo; } catch(e) { return false; } });

  const todayEarn = todayD.reduce((s, o) => s + (o.riderEarning || DELIVERY_FEE), 0);
  const weekEarn  = weekD.reduce((s, o)  => s + (o.riderEarning || DELIVERY_FEE), 0);
  const total     = completedDeliveries.length;
  const avg       = total ? Math.round(completedDeliveries.reduce((s, o) => s + (o.riderEarning || DELIVERY_FEE), 0) / total) : 0;

  document.getElementById('earn-today').textContent = `₱${todayEarn}`;
  document.getElementById('earn-week').textContent  = `₱${weekEarn}`;
  document.getElementById('earn-trips').textContent = total;
  document.getElementById('earn-avg').textContent   = `₱${avg}`;

  const breakdown = document.getElementById('earnings-breakdown');
  const bEmpty    = document.getElementById('earnings-empty');

  if (!completedDeliveries.length) { breakdown.innerHTML = ''; bEmpty.classList.remove('hidden'); return; }

  bEmpty.classList.add('hidden');
  breakdown.innerHTML = completedDeliveries.map(o => {
    const earning = o.riderEarning || DELIVERY_FEE;
    const bonus   = earning > DELIVERY_FEE;
    const time    = o.completedAt ? formatTime(o.completedAt) : '—';
    return `
    <div class="earn-breakdown-item">
      <div class="ebi-left">
        <span class="ebi-id">#${o.id}</span>
        <span class="ebi-meta">${time} · ${(o.payment||'COD').toUpperCase()} · ₱${(o.total||0).toLocaleString()}</span>
      </div>
      <div style="text-align:right">
        <div class="ebi-earn">+₱${earning}</div>
        ${bonus ? `<div style="font-size:10px;color:var(--warn);font-family:var(--mono)">+₱10 bonus</div>` : ''}
      </div>
    </div>`;
  }).join('');
}

function updateEarningsChip() {
  const todayStr  = new Date().toDateString();
  const todayEarn = completedDeliveries
    .filter(o => { try { return new Date(o.completedAt).toDateString() === todayStr; } catch(e) { return false; } })
    .reduce((s, o) => s + (o.riderEarning || DELIVERY_FEE), 0);
  document.getElementById('earnings-chip').textContent = `₱${todayEarn} today`;
}

// ══════════════════════════════════════════════════════════
//  ORDER DETAIL SHEET
// ══════════════════════════════════════════════════════════
async function openOrderSheet(orderId) {
  const all   = await getShopOrders();
  const order = all.find(o => o.id === orderId);
  if (!order) return;
  currentSheetOrder = order;

  const shipping = order.shipping || {};
  const fullName = [shipping.fname, shipping.lname].filter(Boolean).join(' ') || 'Customer';
  const address  = [shipping.address, shipping.city].filter(Boolean).join(', ') || '—';
  const phone    = shipping.phone || '—';
  const email    = shipping.email || order.user_email || '—';
  const payment  = (order.payment || 'cod').toUpperCase();
  const isCod    = payment === 'COD';
  const time     = order.date ? new Date(order.date).toLocaleString('en-PH') : '—';

  document.getElementById('sheet-order-id').textContent   = '#' + order.id;
  document.getElementById('sheet-order-time').textContent = time;

  document.getElementById('sheet-body').innerHTML = `
    <div class="sheet-section">
      <div class="sheet-section-title">Customer</div>
      <div class="sheet-row"><span class="label">Name</span><span class="val">${fullName}</span></div>
      <div class="sheet-row"><span class="label">Phone</span><span class="val">${phone}</span></div>
      <div class="sheet-row"><span class="label">Email</span><span class="val" style="font-size:12px">${email}</span></div>
    </div>
    <div class="sheet-section">
      <div class="sheet-section-title">Delivery Address</div>
      <div class="sheet-row"><span class="val" style="color:var(--text)">${address}</span></div>
    </div>
    <div class="sheet-section">
      <div class="sheet-section-title">Order Items</div>
      ${(order.items || []).map(it =>
        `<div class="sheet-row">
          <span class="label">${it.emoji||'📦'} ${it.name} ×${it.qty}</span>
          <span class="val">₱${(it.price * it.qty).toLocaleString()}</span>
        </div>`
      ).join('')}
      <div class="sheet-total-row">
        <span class="sheet-total-label">TOTAL</span>
        <span class="sheet-total-val">₱${(order.total||0).toLocaleString()}</span>
      </div>
    </div>
    <div class="sheet-section">
      <div class="sheet-section-title">Payment</div>
      <div class="sheet-row">
        <span class="label">Method</span>
        <span class="val">${isCod ? `<span class="cod-badge">COD</span>` : `<span class="gcash-badge">${payment}</span>`}</span>
      </div>
      ${isCod ? `<div class="sheet-row"><span class="label" style="color:var(--warn)">⚠ Collect from customer</span><span class="val" style="color:var(--warn)">₱${(order.total||0).toLocaleString()}</span></div>` : ''}
    </div>`;

  const isActive          = activeDeliveries.some(d => d.id === order.id);
  const isAlreadyAccepted = activeDeliveries.length > 0;
  const isClaimedByOther  = order.rider_id && order.rider_id !== rider?.id;

  document.getElementById('sheet-actions').innerHTML = `
    ${isClaimedByOther ? `<div style="font-size:12px;color:var(--warn);text-align:center;padding:8px;background:rgba(255,170,0,.1);border-radius:8px;margin-bottom:8px">🛵 Being delivered by ${order.rider_name || 'another rider'}</div>` : ''}
    ${!isActive && !isAlreadyAccepted && !isClaimedByOther ? `<button class="btn btn-primary btn-full" onclick="acceptOrder('${order.id}');closeSheet()">Accept This Order →</button>` : ''}
    ${isActive ? `<button class="btn btn-outline btn-full" onclick="switchTab('active');closeSheet()">View Active Delivery →</button>` : ''}
    ${isAlreadyAccepted && !isActive && !isClaimedByOther ? `<div style="font-size:12px;color:var(--text3);text-align:center;padding:4px">Finish your current delivery to accept a new one.</div>` : ''}
    <button class="btn btn-ghost btn-full" onclick="closeSheet()">Close</button>
  `;

  document.getElementById('sheet-overlay').classList.remove('hidden');
  document.getElementById('order-sheet').classList.add('open');
}

function closeSheet() {
  document.getElementById('sheet-overlay').classList.add('hidden');
  document.getElementById('order-sheet').classList.remove('open');
  currentSheetOrder = null;
}

// ══════════════════════════════════════════════════════════
//  ONLINE / OFFLINE TOGGLE
// ══════════════════════════════════════════════════════════
async function toggleStatus() {
  isOnline = !isOnline;
  const statusLabel = document.getElementById('rider-status-label');
  const toggleBtn   = document.getElementById('toggle-btn');
  if (isOnline) {
    statusLabel.textContent = '● ONLINE'; statusLabel.classList.remove('offline');
    toggleBtn.textContent   = 'Go Offline';
    showToast("You're online! Ready to deliver 🛵", 'success');
  } else {
    statusLabel.textContent = '○ OFFLINE'; statusLabel.classList.add('offline');
    toggleBtn.textContent   = 'Go Online';
    showToast("You're offline");
  }
  await setOnlineInDB(isOnline);
  refreshQueue();
}

// ══════════════════════════════════════════════════════════
//  TAB SWITCHING
// ══════════════════════════════════════════════════════════
function switchTab(name) {
  document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
  document.querySelectorAll('.tab-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('tab-' + name).classList.add('active');
  document.getElementById('panel-' + name).classList.add('active');
}

// ══════════════════════════════════════════════════════════
//  REAL-TIME SYNC
// ══════════════════════════════════════════════════════════
function startRealtimeSync() {
  db.channel('rider-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async payload => {
      const updated = payload.new;
      refreshQueue();
      if (updated) {
        const idx = activeDeliveries.findIndex(d => d.id === updated.id);
        if (idx !== -1) {
          activeDeliveries[idx] = { ...activeDeliveries[idx], ...updated };
          renderActive();
        }
      }
    })
    .subscribe();

  // Heartbeat every 30s
  setInterval(() => registerRiderInDB(), 30000);
}

// ══════════════════════════════════════════════════════════
//  HELPERS
// ══════════════════════════════════════════════════════════
function formatTime(iso) {
  try { return new Date(iso).toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' }); }
  catch(e) { return iso || '—'; }
}

function capitalize(s) {
  if (!s) return '';
  return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function showToast(msg, type = '') {
  const container = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-msg' + (type ? ' ' + type : '');
  el.textContent = msg;
  container.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'fadeOut 0.3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 2800);
}

// ── INIT: auto-login if rider session exists ──
if (rider) bootApp();