// ════════════════════════════════════════════════════════
//  CLOUDCHASE VAPE SHOP — Supabase Edition (no hardcoded data)
//  Requires: supabase-config.js loaded first
//  localStorage: cc_cart, cc_wish (session-only), cc_session_email
//  All products, users, orders → Supabase
// ════════════════════════════════════════════════════════

// =================== STATE ===================
let state = {
  user:           null,
  products:       [],    // loaded from Supabase `products` table
  cart:           JSON.parse(localStorage.getItem('cc_cart') || '[]'),
  wishlist:       JSON.parse(localStorage.getItem('cc_wish') || '[]'),
  orders:         [],
  currentProduct: null,
  discount:       0,
};

function saveLocal() {
  localStorage.setItem('cc_cart', JSON.stringify(state.cart));
  localStorage.setItem('cc_wish', JSON.stringify(state.wishlist));
}

const SESSION_KEY = 'cc_session_email';

// =================== PRODUCTS — Supabase ===================
async function loadProducts() {
  const { data, error } = await db.from('products').select('*').order('id', { ascending: true });
  if (error) { console.error('loadProducts:', error); return; }
  state.products = (data || []).map(dbProductToLocal);
}

function dbProductToLocal(row) {
  return {
    id:       row.id,
    name:     row.name,
    cat:      row.category || row.cat || '',
    price:    row.price || 0,
    oldPrice: row.old_price || null,
    emoji:    row.emoji || '📦',
    rating:   row.rating || 0,
    reviews:  row.reviews || 0,
    stock:    row.stock ?? 0,
    badge:    row.badge || null,
    desc:     row.description || row.desc || '',
    specs:    row.specs || {},
    tags:     row.tags || [],
    img:      row.img || row.image || row.image_url || null,
  };
}

// =================== AGE GATE ===================
function enterSite() {
  document.getElementById('age-gate').style.display = 'none';
  init();
}

// =================== INIT ===================
async function init() {
  // Restore session
  const savedEmail = localStorage.getItem(SESSION_KEY);
  if (savedEmail) {
    const { data } = await db.from('users').select('*').eq('email', savedEmail).single();
    if (data) state.user = data;
  }

  await loadProducts();

  renderNav();
  renderFeatured();
  renderBestsellers();
  renderShop();
  renderDeals();
  renderWishlist();
  loadSettings();
  updateCartBadge();
  subscribeToOrderUpdates();
  subscribeToProductUpdates();
  subscribeToPaymentMethodUpdates();
}

// ── Realtime: order status changes ──
function subscribeToOrderUpdates() {
  db.channel('shop-orders')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async payload => {
      // Ignore updates that don't belong to the current user
      const record = payload.new || payload.old;
      if (!state.user) return;
      if (record?.user_email && record.user_email !== state.user.email) return;
      // Always re-fetch from Supabase so both INSERTs and UPDATEs are captured
      const histPage = document.getElementById('page-history');
      if (histPage && histPage.classList.contains('active')) {
        await renderHistory();
      } else {
        const { data } = await db
          .from('orders')
          .select('*')
          .eq('user_email', state.user?.email || '')
          .order('date', { ascending: false });
        if (data) state.orders = data.map(dbOrderToLocal);
      }
    })
    // Surface subscription errors instead of failing silently
    .subscribe((status, err) => {
      if (status === 'SUBSCRIPTION_ERROR') {
        console.error('Order realtime subscription failed:', err);
      }
    });
}

// ── Realtime: product/stock changes pushed by admin ──
function subscribeToProductUpdates() {
  db.channel('shop-products')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'products' }, async () => {
      await loadProducts();
      const shopPage = document.getElementById('page-shop');
      if (shopPage && shopPage.classList.contains('active')) applyFilters();
      // Refresh current product detail if open
      if (state.currentProduct) {
        const updated = state.products.find(p => p.id === state.currentProduct.id);
        if (updated) { state.currentProduct = updated; }
      }
    })
    // Surface subscription errors instead of failing silently
    .subscribe((status, err) => {
      if (status === 'SUBSCRIPTION_ERROR') {
        console.error('Product realtime subscription failed:', err);
      }
    });
}

// ── Realtime: payment method changes pushed by admin ──
function subscribeToPaymentMethodUpdates() {
  // Listen on payment_methods table
  db.channel('shop-payment-methods')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'payment_methods' }, async () => {
      const checkoutPage = document.getElementById('page-checkout');
      if (checkoutPage && checkoutPage.classList.contains('active')) {
        await renderPaymentOptions();
        toast('Payment options have been updated.', '');
      }
    })
    .subscribe();

  // Also listen on shop_settings in case admin stores them there
  db.channel('shop-settings-payments')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'shop_settings' }, async () => {
      const checkoutPage = document.getElementById('page-checkout');
      if (checkoutPage && checkoutPage.classList.contains('active')) {
        await renderPaymentOptions();
        toast('Payment options have been updated.', '');
      }
    })
    .subscribe();
}

// ── map Supabase row → local camelCase ──
function dbOrderToLocal(row) {
  return {
    id:              row.id,
    date:            row.date,
    items:           row.items || [],
    total:           row.total,
    payment:         row.payment,
    shipping:        row.shipping || {},
    status:          row.status,
    userEmail:       row.user_email,
    riderId:         row.rider_id,
    riderName:       row.rider_name,
    riderPhone:      row.rider_phone,
    riderPlate:      row.rider_plate,
    riderAcceptedAt: row.rider_accepted_at,
    riderStep:       row.rider_step,
    deliveredAt:     row.delivered_at,
  };
}

// =================== NAVIGATION ===================
function showPage(p) {
  document.querySelectorAll('.page').forEach(el => el.classList.remove('active'));
  document.getElementById('page-' + p).classList.add('active');
  if (p === 'checkout') renderCheckout();
  if (p === 'history')  renderHistory();
  if (p === 'wishlist') renderWishlist();
  window.scrollTo(0, 0);
  closeCart();
}

function setActive(el) {
  document.querySelectorAll('.sidebar-link').forEach(l => l.classList.remove('active'));
  el.classList.add('active');
}

function requireLogin(fn) {
  if (!state.user) { showModal('login'); return; }
  fn();
}

// =================== MODALS ===================
function showModal(m) { document.getElementById('modal-' + m).style.display = 'flex'; }
function closeModal(m) { document.getElementById('modal-' + m).style.display = 'none'; }

// =================== AUTH ===================
function renderNav() {
  if (state.user) {
    document.getElementById('guest-btns').style.display  = 'none';
    document.getElementById('user-area').style.display   = 'block';
    const initials = (state.user.fname || 'U')[0].toUpperCase();
    document.getElementById('nav-avatar').textContent    = initials;
    document.getElementById('dd-name').textContent       = state.user.fname + ' ' + state.user.lname;
    document.getElementById('dd-email').textContent      = state.user.email;
  } else {
    document.getElementById('guest-btns').style.display  = 'flex';
    document.getElementById('user-area').style.display   = 'none';
  }
}

async function login() {
  const email = document.getElementById('login-email').value.trim();
  const pw    = document.getElementById('login-pw').value;
  const err   = document.getElementById('login-error');
  if (!email || !pw) { err.textContent = 'Please fill in all fields'; err.style.display = 'block'; return; }

  const { data: found } = await db.from('users').select('*').eq('email', email).eq('pw', pw).single();

  if (!found) {
    // demo fallback: any email + 'password123'
    if (pw === 'password123') {
      const demo = { email, fname: 'Demo', lname: 'User', pw, phone: '', addresses: [], joined: new Date().toISOString() };
      const { data: inserted } = await db.from('users').upsert(demo).select().single();
      state.user = inserted || demo;
    } else {
      err.textContent = 'Invalid email or password'; err.style.display = 'block'; return;
    }
  } else {
    state.user = found;
  }

  localStorage.setItem(SESSION_KEY, state.user.email);
  closeModal('login');
  renderNav();
  toast('Welcome back, ' + state.user.fname + '! 👋', 'success');
  loadSettings();
}

async function register() {
  const fname = document.getElementById('reg-fname').value.trim();
  const lname = document.getElementById('reg-lname').value.trim();
  const email = document.getElementById('reg-email').value.trim();
  const pw    = document.getElementById('reg-pw').value;
  const cpw   = document.getElementById('reg-cpw').value;
  const age   = document.getElementById('reg-age').checked;
  const err   = document.getElementById('reg-error');

  if (!fname || !lname || !email || !pw) { err.textContent = 'Please fill in all fields'; err.style.display = 'block'; return; }
  if (pw !== cpw)    { err.textContent = 'Passwords do not match'; err.style.display = 'block'; return; }
  if (pw.length < 8) { err.textContent = 'Password must be at least 8 characters'; err.style.display = 'block'; return; }
  if (!age)          { err.textContent = 'You must confirm you are 18+'; err.style.display = 'block'; return; }

  const { data: existing } = await db.from('users').select('id').eq('email', email).single();
  if (existing) { err.textContent = 'Email already registered'; err.style.display = 'block'; return; }

  const newUser = { fname, lname, email, pw, phone: '', addresses: [], joined: new Date().toISOString() };
  const { data: inserted, error } = await db.from('users').insert(newUser).select().single();
  if (error) { err.textContent = 'Registration failed. Please try again.'; err.style.display = 'block'; return; }

  state.user = inserted;
  localStorage.setItem(SESSION_KEY, state.user.email);
  closeModal('register');
  renderNav();
  toast('Account created! Welcome, ' + fname + '! 🎉', 'success');
  loadSettings();
}

function logout() {
  state.user = null;
  localStorage.removeItem(SESSION_KEY);
  renderNav();
  closeDropdown();
  toast('Logged out. See you soon!');
  showPage('home');
}

function toggleProfileDropdown() { document.getElementById('profile-dropdown').classList.toggle('hidden'); }
function closeDropdown()          { document.getElementById('profile-dropdown').classList.add('hidden'); }
document.addEventListener('click', function(e) {
  const dd = document.getElementById('profile-dropdown');
  const av = document.getElementById('nav-avatar');
  if (dd && av && !dd.contains(e.target) && !av.contains(e.target)) dd.classList.add('hidden');
});

// =================== PRODUCTS — RENDER ===================
function productCard(p, extra = '') {
  const inWish = state.wishlist.includes(p.id);
  const oos    = p.stock === 0;
  return `<div class="product-card ${oos ? 'out-of-stock' : ''}" onclick="openProduct(${p.id})">
    ${p.badge ? `<div class="product-badge badge-${p.badge}">${p.badge.toUpperCase()}</div>` : ''}
    <div class="product-img-wrap">
      ${p.img ? `<img class="product-img-real" src="${p.img}" alt="${p.name}" loading="lazy" onerror="this.style.display='none'">` : `<div class="product-img-placeholder"></div>`}
    </div>
    <button class="wish-btn${inWish ? ' active' : ''}" onclick="event.stopPropagation();toggleWish(${p.id})" title="${inWish ? 'Remove from wishlist' : 'Add to wishlist'}"></button>
    <div class="product-body">
      <div class="product-cat">${p.cat}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-rating"><span>★</span> ${p.rating} (${p.reviews})</div>
      ${p.stock > 0 && p.stock < 10 ? `<div class="stock-badge">Only ${p.stock} left</div>` : ''}
      <div class="product-footer">
        <div class="product-price">${p.oldPrice ? `<span class="old">₱${p.oldPrice.toLocaleString()}</span>` : ''}₱${p.price.toLocaleString()}</div>
        <button class="add-cart-btn" onclick="event.stopPropagation();addToCart(${p.id})">${oos ? 'Out of Stock' : '+ Add'}</button>
      </div>
    </div>
  </div>`;
}

function renderFeatured()    {
  const items = state.products.filter(p => p.badge).slice(0, 4);
  document.getElementById('featured-grid').innerHTML = items.length
    ? items.map(p => productCard(p)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><p>No featured products yet.</p></div>';
}
function renderBestsellers() {
  const items = [...state.products].sort((a, b) => b.reviews - a.reviews).slice(0, 4);
  document.getElementById('bestseller-grid').innerHTML = items.length
    ? items.map(p => productCard(p)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><p>No products yet.</p></div>';
}
function renderShop(list = state.products) {
  document.getElementById('shop-grid').innerHTML = list.length
    ? list.map(p => productCard(p)).join('')
    : `<div class="empty-state" style="grid-column:1/-1"><div class="icon">🔍</div><h3>No products found</h3><p>Try adjusting your filters or search terms.</p></div>`;
  document.getElementById('results-count').textContent = `Showing ${list.length} product${list.length !== 1 ? 's' : ''}`;
}
function renderDeals() {
  const items = state.products.filter(p => p.oldPrice || p.badge === 'sale' || p.badge === 'hot');
  document.getElementById('deals-grid').innerHTML = items.length
    ? items.map(p => productCard(p)).join('')
    : '<div class="empty-state" style="grid-column:1/-1"><p>No deals right now. Check back soon!</p></div>';
}

let currentFilter = 'all', currentSort = 'default';
function filterCategory(cat)   { currentFilter = cat; applyFilters(); showPage('shop'); document.getElementById('cat-select').value = cat; }
function filterByCategory(cat) { currentFilter = cat; applyFilters(); }
function sortProducts(sort)    { currentSort   = sort; applyFilters(); }
function applyFilters() {
  let list = currentFilter === 'all' ? [...state.products] : state.products.filter(p => p.cat === currentFilter);
  if (currentSort === 'price-asc')   list.sort((a, b) => a.price - b.price);
  else if (currentSort === 'price-desc') list.sort((a, b) => b.price - a.price);
  else if (currentSort === 'rating')     list.sort((a, b) => b.rating - a.rating);
  else if (currentSort === 'newest')     list.sort((a, b) => b.id - a.id);
  renderShop(list);
}

// =================== PRODUCT DETAIL ===================
function openProduct(id) {
  const p = state.products.find(x => x.id === id);
  if (!p) return;
  state.currentProduct = p;
  const specs = p.specs && Object.keys(p.specs).length
    ? Object.entries(p.specs).map(([k, v]) => `<div class="spec-row"><span class="sk">${k}</span><span>${v}</span></div>`).join('')
    : '';
  document.getElementById('product-detail-content').innerHTML = `
    <div class="product-detail">
      <div class="product-detail-img${p.img ? ' product-detail-img-photo' : ''}">${p.img ? `<img src="${p.img}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;">` : ''}</div>
      <div class="product-detail-info">
        <div class="product-cat">${p.cat.toUpperCase()}</div>
        <div class="product-name">${p.name}</div>
        <div class="pd-rating-row">
          <div class="pd-rating-stars">★★★★★</div>
          <span class="pd-rating-text">${p.rating} · ${p.reviews} reviews</span>
        </div>
        <div class="price-lg">₱${p.price.toLocaleString()} ${p.oldPrice ? `<span class="pd-old-price">₱${p.oldPrice.toLocaleString()}</span>` : ''}</div>
        <p class="pd-desc">${p.desc}</p>
        <div class="product-tags">${(p.tags||[]).map(t => `<span class="product-tag">${t}</span>`).join('')}</div>
        <div class="qty-control">
          <button class="qty-btn" onclick="changeQty(-1)">−</button>
          <span class="qty-val" id="pd-qty">1</span>
          <button class="qty-btn" onclick="changeQty(1)">+</button>
          <span class="pd-stock-label">${p.stock} in stock</span>
        </div>
        <div class="pd-add-row">
          <button class="btn btn-primary" onclick="addToCartQty(${p.id})">Add to Cart</button>
          <button class="btn btn-outline btn-icon pd-wish-btn${state.wishlist.includes(p.id) ? ' active-wish' : ''}" onclick="toggleWish(${p.id})" id="pd-wish"></button>
        </div>
        ${specs ? `<div class="spec-list"><div class="pd-spec-heading">Specifications</div>${specs}</div>` : ''}
      </div>
    </div>`;
  showPage('product');
}

let pdQty = 1;
function changeQty(d) {
  const stock = state.currentProduct ? state.currentProduct.stock : Infinity;
  if (d > 0 && pdQty >= stock) { toast('Only ' + stock + ' in stock', 'error'); return; }
  pdQty = Math.max(1, Math.min(pdQty + d, stock));
  document.getElementById('pd-qty').textContent = pdQty;
}
function addToCartQty(id) { addToCart(id, pdQty); pdQty = 1; if (document.getElementById('pd-qty')) document.getElementById('pd-qty').textContent = 1; }

// =================== WISHLIST ===================
function toggleWish(id) {
  const idx = state.wishlist.indexOf(id);
  if (idx > -1) state.wishlist.splice(idx, 1); else state.wishlist.push(id);
  saveLocal(); renderWishlist(); updateWishCount();
  toast(state.wishlist.includes(id) ? 'Added to wishlist' : 'Removed from wishlist');
}
function updateWishCount() {
  const c = state.wishlist.length;
  document.getElementById('wish-nav-count').textContent   = c;
  document.getElementById('wish-nav-count').style.display = c ? 'inline' : 'none';
}
function renderWishlist() {
  updateWishCount();
  const items = state.products.filter(p => state.wishlist.includes(p.id));
  const grid  = document.getElementById('wishlist-grid');
  if (!grid) return;
  grid.innerHTML = items.length ? items.map(p => productCard(p)).join('') : `<div class="empty-state" style="grid-column:1/-1"><h3>Your wishlist is empty</h3><p>Browse products and tap + to save items here.</p><button class="btn btn-primary" onclick="showPage('shop')">Browse Shop</button></div>`;
}

// =================== CART ===================
function addToCart(id, qty = 1) {
  const p = state.products.find(x => x.id === id);
  if (!p || p.stock === 0) return;
  const existing = state.cart.find(x => x.id === id);
  if (existing) {
    if (existing.qty >= p.stock) { toast('No more stock available for ' + p.name, 'error'); return; }
    existing.qty = Math.min(existing.qty + qty, p.stock);
  } else {
    state.cart.push({ id, qty: Math.min(qty, p.stock) });
  }
  saveLocal(); updateCartBadge(); renderCartDrawer(); toast(p.name + ' added to cart', 'success');
}

function updateCartBadge() {
  const total = state.cart.reduce((s, x) => s + x.qty, 0);
  const badge = document.getElementById('cart-badge');
  badge.textContent = total; badge.style.display = total ? 'flex' : 'none';
  document.getElementById('cart-count-drawer').textContent = total;
}

function removeFromCart(id)   { state.cart = state.cart.filter(x => x.id !== id); saveLocal(); updateCartBadge(); renderCartDrawer(); }

function changeCartQty(id, d) {
  const item = state.cart.find(x => x.id === id);
  const p    = state.products.find(x => x.id === id);
  if (!item) return;
  if (d > 0 && p && item.qty >= p.stock) { toast('Only ' + p.stock + ' in stock', 'error'); return; }
  const newQty = Math.min(item.qty + d, p ? p.stock : 99);
  if (newQty < 1) { removeFromCart(id); return; }
  item.qty = newQty;
  saveLocal(); updateCartBadge(); renderCartDrawer();
}

function getCartTotals() {
  const sub      = state.cart.reduce((s, x) => { const p = state.products.find(pr => pr.id === x.id); return s + (p ? p.price * x.qty : 0); }, 0);
  const shipping = 50;
  const disc     = Math.round(sub * state.discount);
  const total    = sub + shipping - disc;
  return { sub, shipping, disc, total };
}

function renderCartDrawer() {
  const list = document.getElementById('cart-items-list');
  if (!state.cart.length) {
    list.innerHTML = `<div class="cart-empty"><p>Your cart is empty</p><button class="btn btn-primary" onclick="showPage('shop');closeCart()" style="margin-top:12px">Start Shopping</button></div>`;
  } else {
    list.innerHTML = state.cart.map(item => {
      const p = state.products.find(x => x.id === item.id);
      if (!p) return '';
      return `<div class="cart-item">
        <div class="cart-item-img">${p.img ? `<img src="${p.img}" alt="${p.name}" style="width:100%;height:100%;object-fit:cover;border-radius:8px;">` : ''}</div>
        <div class="cart-item-info">
          <div class="cart-item-name">${p.name}</div>
          <div class="cart-item-price">₱${(p.price * item.qty).toLocaleString()}</div>
          <div class="cart-item-qty">
            <button class="cart-qty-btn" onclick="changeCartQty(${p.id},-1)">−</button>
            <span class="cart-qty-val">${item.qty}</span>
            <button class="cart-qty-btn" onclick="changeCartQty(${p.id},1)">+</button>
          </div>
        </div>
        <button class="remove-item" onclick="removeFromCart(${p.id})">✕</button>
      </div>`;
    }).join('');
  }
  const t = getCartTotals();
  document.getElementById('cart-subtotal').textContent = '₱' + t.sub.toLocaleString();
  document.getElementById('cart-total').textContent    = '₱' + t.total.toLocaleString();
}

function openCart()  { renderCartDrawer(); document.getElementById('cart-drawer').classList.add('open'); document.getElementById('cart-overlay').classList.add('show'); }
function closeCart() { document.getElementById('cart-drawer').classList.remove('open'); document.getElementById('cart-overlay').classList.remove('show'); }
function goCheckout() {
  if (!state.cart.length) { toast('Your cart is empty!', 'error'); return; }
  requireLogin(() => { closeCart(); showPage('checkout'); });
}

// =================== CHECKOUT ===================

// Payment methods — must match admin's PAYMENT_METHODS list exactly
// Admin table: payment_methods  columns: id (text PK), enabled (boolean)
const ALL_PAYMENT_METHODS = [
  { id: 'cod',   label: 'Cash on Delivery (COD)' },
  { id: 'gcash', label: 'GCash' },
  { id: 'maya',  label: 'Maya / PayMaya' },
  { id: 'card',  label: 'Credit/Debit Card' },
];

async function renderCheckout() {
  const summary = document.getElementById('checkout-summary');
  summary.innerHTML = state.cart.map(item => {
    const p = state.products.find(x => x.id === item.id);
    if (!p) return '';
    return `<div class="order-summary-item"><span>${p.name} <span class="muted-qty">x${item.qty}</span></span><span class="mono">₱${(p.price * item.qty).toLocaleString()}</span></div>`;
  }).join('');
  renderCheckoutTotals();
  if (state.user) {
    document.getElementById('co-fname').value = state.user.fname || '';
    document.getElementById('co-lname').value = state.user.lname || '';
    document.getElementById('co-email').value = state.user.email || '';
  }
  await renderPaymentOptions();
}

async function renderPaymentOptions() {
  const container = document.getElementById('payment-options');
  if (!container) return;

  // Query payment_methods table — column is `id` (not `value`), per admin schema
  const { data: rows, error } = await db
    .from('payment_methods')
    .select('id, enabled');

  let enabledIds;
  if (error || !rows || !rows.length) {
    // Table missing or empty — fall back to all enabled so shop still works
    console.warn('payment_methods table unavailable, defaulting to all enabled:', error);
    enabledIds = new Set(ALL_PAYMENT_METHODS.map(m => m.id));
  } else {
    enabledIds = new Set(rows.filter(r => r.enabled).map(r => r.id));
  }

  const activeMethods = ALL_PAYMENT_METHODS.filter(m => enabledIds.has(m.id));

  if (!activeMethods.length) {
    container.innerHTML = `<p style="color:var(--danger);font-size:13px;">No payment methods are currently available. Please contact the shop.</p>`;
    return;
  }

  container.innerHTML = activeMethods.map((m, i) => `
    <label class="payment-option">
      <input type="radio" name="payment" value="${m.id}"${i === 0 ? ' checked' : ''}>
      <span>${m.label}</span>
    </label>`).join('');
}

function renderCheckoutTotals() {
  const t = getCartTotals();
  document.getElementById('checkout-totals').innerHTML = `
    <div class="order-total-row"><span>Subtotal</span><span>₱${t.sub.toLocaleString()}</span></div>
    ${t.disc ? `<div class="order-total-row discount-row"><span>Discount</span><span>-₱${t.disc.toLocaleString()}</span></div>` : ''}
    <div class="order-total-row"><span>Shipping</span><span>₱${t.shipping.toLocaleString()}</span></div>
    <div class="order-total-row final"><span>Total</span><span>₱${t.total.toLocaleString()}</span></div>`;
}

async function applyPromo() {
  const code = document.getElementById('promo-input').value.trim().toUpperCase();
  const msg  = document.getElementById('promo-msg');

  // Fetch promo from Supabase
  const { data: promo } = await db.from('promos').select('*').eq('code', code).eq('active', true).single();

  if (promo) {
    state.discount = promo.discount_pct / 100;
    msg.style.color = 'var(--success)';
    msg.textContent = `✓ Code applied! ${promo.discount_pct}% off`;
    renderCheckoutTotals();
    toast('Promo code applied! 🎉', 'success');
  } else {
    msg.style.color = 'var(--danger)';
    msg.textContent = 'Invalid promo code';
    state.discount  = 0;
    renderCheckoutTotals();
  }
}

function copyCode(code) { navigator.clipboard.writeText(code).catch(() => {}); toast('Code copied: ' + code + ' 📋', 'success'); }

async function placeOrder() {
  const fname   = document.getElementById('co-fname').value.trim();
  const lname   = document.getElementById('co-lname').value.trim();
  const email   = document.getElementById('co-email').value.trim();
  const phone   = document.getElementById('co-phone').value.trim();
  const address = document.getElementById('co-address').value.trim();
  const city    = document.getElementById('co-city').value.trim();
  if (!fname || !lname || !email || !phone || !address || !city) { toast('Please fill in all shipping fields', 'error'); return; }
  if (!state.cart.length) { toast('Your cart is empty', 'error'); return; }

  const selectedRadio = document.querySelector('input[name="payment"]:checked');
  if (!selectedRadio) { toast('Please select a payment method', 'error'); return; }
  const payment = selectedRadio.value;

  // Re-validate payment method is still enabled (guard against stale UI)
  await renderPaymentOptions();
  const stillAvailable = document.querySelector(`input[name="payment"][value="${payment}"]`);
  if (!stillAvailable) {
    toast('The selected payment method is no longer available. Please choose another.', 'error');
    return;
  }

  const t       = getCartTotals();
  const orderId = Date.now();

  const order = {
    id:         orderId,
    date:       new Date().toISOString(),
    items:      state.cart.map(x => {
      const p = state.products.find(pr => pr.id === x.id);
      return { id: p.id, name: p.name, emoji: p.emoji, qty: x.qty, price: p.price };
    }),
    total:      t.total,
    payment,
    shipping:   { fname, lname, email, phone, address, city },
    status:     'processing',
    user_email: state.user?.email || null,
  };

  const { error } = await db.from('orders').insert(order);
  if (error) { toast('Order failed — please try again', 'error'); console.error(error); return; }

  state.orders.unshift(dbOrderToLocal(order));
  state.cart     = [];
  state.discount = 0;
  saveLocal();
  updateCartBadge();
  renderCartDrawer();
  document.getElementById('success-order-id').textContent = '#' + orderId;
  showModal('success');
}

// =================== ORDER HISTORY ===================
async function renderHistory() {
  const el = document.getElementById('history-list');
  if (!el) return;

  const { data, error } = await db
    .from('orders')
    .select('*')
    .eq('user_email', state.user?.email || '')
    .order('date', { ascending: false });

  if (error) { el.innerHTML = `<div class="empty-state"><p>Could not load orders.</p></div>`; return; }
  state.orders = (data || []).map(dbOrderToLocal);

  if (!state.orders.length) {
    el.innerHTML = `<div class="empty-state"><h3>No orders yet</h3><p>You haven't placed any orders. Start shopping to see your order history here.</p><button class="btn btn-primary" onclick="showPage('shop')">Shop Now</button></div>`;
    return;
  }

  // Fetch products the user has already reviewed so we can mark them
  let reviewedProductIds = new Set();
  const { data: existingReviews } = await db
    .from('reviews')
    .select('product_id')
    .eq('user_email', state.user?.email || '');
  if (existingReviews) existingReviews.forEach(r => reviewedProductIds.add(r.product_id));

  el.innerHTML = state.orders.map(o => {
    const statusClass = { processing:'processing', shipped:'shipped', out_for_delivery:'shipped', delivered:'delivered', cancelled:'cancelled' }[o.status] || 'processing';
    const statusLabel = { processing:'Processing', shipped:'Shipped', out_for_delivery:'Out for Delivery', delivered:'Delivered', cancelled:'Cancelled', pending:'Pending' }[o.status] || (o.status.charAt(0).toUpperCase() + o.status.slice(1));
    const riderInfo = o.riderName && (o.status === 'out_for_delivery' || o.status === 'delivered')
      ? `<div class="history-rider-info">🛵 <strong>${o.riderName}</strong> is handling your order${o.riderPhone ? ` · ${o.riderPhone}` : ''}</div>`
      : '';

    // Per-item review buttons — only shown for delivered orders
    const reviewSection = o.status === 'delivered'
      ? `<div class="review-items-section">
          <div class="review-section-label">⭐ Rate your items</div>
          <div class="review-items-list">
            ${o.items.map(item => {
              const product = item.id
                ? state.products.find(p => p.id === item.id)
                : state.products.find(p => p.name === item.name);
              const productId = product ? product.id : null;
              if (!productId) return '';
              const already = reviewedProductIds.has(productId);
              return already
                ? `<div class="review-item-row">
                    <span class="review-item-name">${item.name}</span>
                    <span class="review-done-badge">✓ Reviewed</span>
                  </div>`
                : `<div class="review-item-row">
                    <span class="review-item-name">${item.name}</span>
                    <button class="btn btn-sm review-btn-item" onclick="openReviewModal(${productId}, '${o.id}')">Write a Review ✍️</button>
                  </div>`;
            }).join('')}
          </div>
        </div>`
      : '';

    return `<div class="history-item">
      <div class="history-header">
        <div><div class="order-id">#${o.id}</div><div class="order-date">${new Date(o.date).toLocaleDateString('en-PH',{year:'numeric',month:'long',day:'numeric'})}</div></div>
        <span class="order-status status-${statusClass}">${statusLabel}</span>
      </div>
      ${riderInfo}
      <div class="history-products">${o.items.map(i => `<span class="history-product-tag">${i.name} x${i.qty}</span>`).join('')}</div>
      <div class="history-footer">
        <div class="order-date">Payment: ${o.payment.toUpperCase()} · ${o.shipping.city}</div>
        <div class="history-total">₱${o.total.toLocaleString()}</div>
      </div>
      ${reviewSection}
    </div>`;
  }).join('');
}

// =================== SETTINGS ===================
function showSettingsPanel(id, el) {
  document.querySelectorAll('.settings-panel').forEach(p => p.classList.remove('active'));
  document.getElementById('settings-' + id).classList.add('active');
  document.querySelectorAll('.settings-nav-item').forEach(n => n.classList.remove('active'));
  el.classList.add('active');
}

function loadSettings() {
  if (!state.user) return;
  document.getElementById('s-fname').value = state.user.fname || '';
  document.getElementById('s-lname').value = state.user.lname || '';
  document.getElementById('s-email').value = state.user.email || '';
  document.getElementById('s-phone').value = state.user.phone || '';
  renderSavedAddresses();
}

async function saveProfile() {
  if (!state.user) { toast('Please login first', 'error'); return; }
  state.user.fname = document.getElementById('s-fname').value.trim();
  state.user.lname = document.getElementById('s-lname').value.trim();
  state.user.phone = document.getElementById('s-phone').value.trim();
  await db.from('users').update({ fname: state.user.fname, lname: state.user.lname, phone: state.user.phone }).eq('email', state.user.email);
  renderNav();
  toast('Profile saved! ✓', 'success');
}

async function changePassword() {
  if (!state.user) return;
  const oldpw = document.getElementById('s-oldpw').value;
  const newpw = document.getElementById('s-newpw').value;
  const conpw = document.getElementById('s-conpw').value;
  if (oldpw !== state.user.pw) { toast('Current password is incorrect', 'error'); return; }
  if (newpw.length < 8)        { toast('New password must be 8+ characters', 'error'); return; }
  if (newpw !== conpw)         { toast('Passwords do not match', 'error'); return; }
  state.user.pw = newpw;
  await db.from('users').update({ pw: newpw }).eq('email', state.user.email);
  toast('Password updated!', 'success');
}

async function saveAddress() {
  if (!state.user) { toast('Please login first', 'error'); return; }
  const addr = document.getElementById('s-addr').value.trim();
  const city = document.getElementById('s-addr-city').value.trim();
  const zip  = document.getElementById('s-addr-zip').value.trim();
  if (!addr || !city) { toast('Please fill address fields', 'error'); return; }
  if (!state.user.addresses) state.user.addresses = [];
  state.user.addresses.push({ addr, city, zip });
  await db.from('users').update({ addresses: state.user.addresses }).eq('email', state.user.email);
  renderSavedAddresses();
  toast('Address saved!', 'success');
}

function renderSavedAddresses() {
  const el = document.getElementById('saved-addresses');
  if (!el || !state.user) return;
  const addrs = state.user.addresses || [];
  if (!addrs.length) { el.innerHTML = '<p class="no-addresses">No saved addresses yet.</p>'; return; }
  el.innerHTML = addrs.map((a, i) => `<div class="saved-address-item"><span>${a.addr}, ${a.city} ${a.zip}</span><button class="btn btn-sm btn-danger" onclick="deleteAddress(${i})">✕</button></div>`).join('');
}

async function deleteAddress(i) {
  state.user.addresses.splice(i, 1);
  await db.from('users').update({ addresses: state.user.addresses }).eq('email', state.user.email);
  renderSavedAddresses();
  toast('Address removed');
}

async function clearHistory() {
  if (!confirm('Clear all order history? This cannot be undone.')) return;
  await db.from('orders').delete().eq('user_email', state.user?.email);
  state.orders = [];
  renderHistory();
  toast('Order history cleared');
}

async function deleteAccount() {
  if (!confirm('Delete your account? This is permanent!')) return;
  await db.from('orders').delete().eq('user_email', state.user.email);
  await db.from('users').delete().eq('email', state.user.email);
  state.user = null;
  localStorage.removeItem(SESSION_KEY);
  renderNav();
  showPage('home');
  toast('Account deleted.');
}

// =================== CONTACT ===================
async function sendContactForm() {
  const name  = document.getElementById('contact-name').value.trim();
  const email = document.getElementById('contact-email').value.trim();
  const msg   = document.getElementById('contact-msg').value.trim();
  if (!name || !email || !msg) { toast('Please fill in all fields', 'error'); return; }

  await db.from('contact_messages').insert({ name, email, message: msg, sent_at: new Date().toISOString() });

  toast("Message sent! We'll get back to you soon 📧", 'success');
  document.getElementById('contact-name').value  = '';
  document.getElementById('contact-email').value = '';
  document.getElementById('contact-msg').value   = '';
}

// =================== SEARCH ===================
function handleSearch(q) {
  const res = document.getElementById('search-results');
  if (!q.trim()) { res.classList.remove('show'); return; }
  const matches = state.products.filter(p =>
    p.name.toLowerCase().includes(q.toLowerCase()) ||
    p.cat.toLowerCase().includes(q.toLowerCase()) ||
    (p.tags || []).some(t => t.toLowerCase().includes(q.toLowerCase()))
  );
  if (!matches.length) { res.innerHTML = '<div class="search-no-results">No results found</div>'; res.classList.add('show'); return; }
  res.innerHTML = matches.slice(0, 6).map(p => `<div class="search-item" onclick="openProduct(${p.id});document.getElementById('search-input').value='';document.getElementById('search-results').classList.remove('show')">
    <div class="search-item-placeholder"></div>
    <div style="flex:1"><div class="name">${p.name}</div><div class="price">₱${p.price.toLocaleString()}</div></div>
  </div>`).join('');
  res.classList.add('show');
}

document.addEventListener('click', function(e) {
  const sr = document.getElementById('search-results');
  const si = document.getElementById('search-input');
  if (sr && si && !sr.contains(e.target) && !si.contains(e.target)) sr.classList.remove('show');
});

// =================== TOAST ===================
function toast(msg, type = '') {
  const t  = document.getElementById('toast');
  const el = document.createElement('div');
  el.className = 'toast-msg' + (type ? ' ' + type : '');
  el.textContent = msg; t.appendChild(el);
  setTimeout(() => { el.style.animation = 'fadeOut .3s ease forwards'; setTimeout(() => el.remove(), 300); }, 3000);
}

// =================== SIDEBAR TOGGLE (MOBILE) ===================
function toggleSidebar() {
  const s = document.getElementById('sidebar');
  const isOpen = s.classList.toggle('open');
  s.classList.toggle('hidden', !isOpen);
  document.getElementById('main').classList.toggle('full', !isOpen);
}

if (window.innerWidth <= 768) {
  document.getElementById('main').classList.add('full');
  document.getElementById('footer').classList.add('full');
}

window.addEventListener('resize', () => {
  const toggle = document.getElementById('menu-toggle');
  if (toggle) toggle.style.display = window.innerWidth <= 768 ? 'block' : 'none';
});
// =================== REVIEWS ===================
let reviewStarValue = 0;
let reviewProductId = null;
let reviewOrderId   = null;

function openReviewModal(productId, orderId) {
  reviewProductId = productId;
  reviewOrderId   = orderId || null;
  reviewStarValue = 0;
  const p = state.products.find(x => x.id === productId);
  document.getElementById('review-product-name').textContent = p ? p.name : '';
  document.getElementById('review-text').value = '';
  document.getElementById('review-error').style.display = 'none';
  document.querySelectorAll('#review-stars .star').forEach(s => {
    s.classList.remove('active');
    s.textContent = '☆';
  });
  document.getElementById('review-star-label').textContent = 'Tap a star to rate';
  showModal('review');
}

function setReviewStar(val) {
  reviewStarValue = val;
  const labels = ['', 'Poor', 'Fair', 'Good', 'Great', 'Excellent'];
  document.getElementById('review-star-label').textContent = labels[val] || '';
  document.querySelectorAll('#review-stars .star').forEach((s, i) => {
    s.classList.toggle('active', i < val);
    s.textContent = i < val ? '★' : '☆';
  });
}

async function submitReview() {
  const text  = document.getElementById('review-text').value.trim();
  const errEl = document.getElementById('review-error');
  if (!reviewStarValue) { errEl.textContent = 'Please select a star rating.'; errEl.style.display = 'block'; return; }
  if (!text)            { errEl.textContent = 'Please write a review.';        errEl.style.display = 'block'; return; }
  errEl.style.display = 'none';

  const reviewProduct = state.products.find(p => p.id === reviewProductId);
  const { error: reviewErr } = await db.from('reviews').insert({
    order_id:     String(reviewOrderId || ''),
    product_id:   reviewProductId,
    product_name: reviewProduct?.name || '',
    user_email:   state.user?.email || '',
    user_name:    [state.user?.fname, state.user?.lname].filter(Boolean).join(' ') || state.user?.email || '',
    rating:       reviewStarValue,
    body:         text,
    status:       'published',
  });

  if (reviewErr) {
    errEl.textContent = 'Failed to submit review. Please try again.';
    errEl.style.display = 'block';
    console.error('submitReview error:', reviewErr);
    return;
  }

  closeModal('review');
  toast('Review submitted! Thanks 🌟', 'success');
  // Refresh history so the Reviewed badge appears immediately
  const histPage = document.getElementById('page-history');
  if (histPage && histPage.classList.contains('active')) renderHistory();
}