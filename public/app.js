// =====================================================
// 全局状态
// =====================================================
let currentUser = null;          // { id, phone, role }
let currentTab = 'home';         // 当前激活的标签名
const socket = io();

// DOM 引用
const homeContent = document.getElementById('homeContent');
const panelHome = document.getElementById('panelHome');
const panelOrders = document.getElementById('panelOrders');
const panelDishes = document.getElementById('panelDishes');
const panelProfile = document.getElementById('panelProfile');
const bottomNav = document.getElementById('bottomNav');
const profilePhone = document.getElementById('profilePhone');
const profileRole = document.getElementById('profileRole');
const profileLogoutBtn = document.getElementById('profileLogoutBtn');

// 模态框
const modal = document.getElementById('roleModal');
const roleOptions = document.querySelectorAll('.role-option');
const closeModalBtn = document.getElementById('closeModalBtn');

// =====================================================
// 菜品相关函数
// =====================================================
async function loadDishes() {
    try {
        const res = await axios.get('/api/dishes');
        return res.data;
    } catch (err) {
        console.error('加载菜品失败', err);
        return [];
    }
}

// 更新合计（计算所有选中菜品价格*数量之和）
function updateTotal() {
    const items = document.querySelectorAll('.dish-item');
    let total = 0;
    items.forEach(item => {
        const checkbox = item.querySelector('.dish-checkbox');
        if (checkbox && checkbox.checked) {
            const price = parseFloat(item.dataset.price) || 0;
            const qtyInput = item.querySelector('.qty-input');
            const qty = parseInt(qtyInput.value) || 1;
            total += price * qty;
        }
    });
    const totalEl = document.getElementById('dishTotal');
    if (totalEl) {
        totalEl.textContent = `合计：¥${total.toFixed(2)}`;
    }
}

// 渲染用户下单界面的菜品列表（多选+数量）—— 优化布局和样式，增加合计行
async function renderUserDishesToContainer() {
    const container = document.getElementById('dishOptionsContainer');
    if (!container) return;
    const dishes = await loadDishes();
    container.innerHTML = '';
    dishes.forEach(dish => {
        const div = document.createElement('div');
        div.className = 'dish-item';
        div.dataset.id = dish.id;
        div.dataset.price = dish.price; // 存储价格用于计算合计
        div.innerHTML = `
            <label class="dish-checkbox-label">
                <input type="checkbox" value="${dish.emoji} ${dish.name}" class="dish-checkbox">
                <span class="custom-checkbox"></span>
                <span class="dish-emoji">${dish.emoji}</span>
                <span class="dish-name">${dish.name}</span>
                <span class="dish-price">¥${dish.price}</span>
            </label>
            <div class="dish-quantity">
                <span>数量</span>
                <input type="number" min="1" value="1" class="qty-input" disabled>
            </div>
        `;
        const checkbox = div.querySelector('.dish-checkbox');
        const qtyInput = div.querySelector('.qty-input');
        // 监听变化以更新合计
        checkbox.addEventListener('change', () => {
            qtyInput.disabled = !checkbox.checked;
            if (!checkbox.checked) qtyInput.value = 1;
            updateTotal();
        });
        qtyInput.addEventListener('input', updateTotal);
        container.appendChild(div);
    });
    // 添加合计行（紧贴菜品列表）
    const totalDiv = document.createElement('div');
    totalDiv.className = 'dish-total';
    totalDiv.id = 'dishTotal';
    totalDiv.textContent = '合计：¥0.00';
    container.appendChild(totalDiv);
    // 初始化合计
    updateTotal();
}

// 获取选中的菜品字符串（下单时使用）
function getSelectedDishes() {
    const items = [];
    document.querySelectorAll('.dish-item').forEach(item => {
        const checkbox = item.querySelector('.dish-checkbox');
        if (checkbox && checkbox.checked) {
            const dishName = checkbox.value;
            const qty = item.querySelector('.qty-input').value;
            items.push(`${dishName} x${qty}`);
        }
    });
    return items.join(', ');
}

// 商家渲染菜品管理（不变）
async function renderMerchantDishes() {
    if (!currentUser || currentUser.role !== 'merchant') return;
    const dishes = await loadDishes();
    const container = document.getElementById('dishManagementList');
    if (!container) return;
    if (dishes.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无菜品，请添加</div>';
        return;
    }
    const html = dishes.map(dish => `
        <div class="dish-manage-item" data-id="${dish.id}">
            <div class="dish-manage-fields">
                <input type="text" class="dish-name-input" value="${escapeHtml(dish.name)}" placeholder="菜名">
                <input type="number" class="dish-price-input" value="${dish.price}" placeholder="价格">
                <input type="text" class="dish-emoji-input" value="${dish.emoji}" placeholder="emoji" maxlength="2">
            </div>
            <div class="dish-manage-actions">
                <button class="btn small save-dish-btn">保存</button>
                <button class="btn small delete-dish-btn" style="background:#e74c3c;">删除</button>
            </div>
        </div>
    `).join('');
    container.innerHTML = html;
    
    document.querySelectorAll('.save-dish-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const item = btn.closest('.dish-manage-item');
            const id = item.dataset.id;
            const name = item.querySelector('.dish-name-input').value.trim();
            const price = parseInt(item.querySelector('.dish-price-input').value);
            const emoji = item.querySelector('.dish-emoji-input').value.trim() || '🍽️';
            if (!name || isNaN(price)) {
                alert('请填写有效的菜名和价格');
                return;
            }
            try {
                await axios.put(`/api/dishes/${id}`, { name, price, emoji });
                alert('保存成功');
                await renderMerchantDishes();
                renderHomeContent(); // 更新用户点餐界面
            } catch (err) {
                alert('保存失败: ' + (err.response?.data?.error || err.message));
            }
        });
    });
    
    document.querySelectorAll('.delete-dish-btn').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            if (!confirm('确定删除此菜品吗？')) return;
            const id = btn.closest('.dish-manage-item').dataset.id;
            try {
                await axios.delete(`/api/dishes/${id}`);
                alert('删除成功');
                await renderMerchantDishes();
                renderHomeContent();
            } catch (err) {
                alert('删除失败: ' + (err.response?.data?.error || err.message));
            }
        });
    });
}

document.getElementById('addDishBtn')?.addEventListener('click', async () => {
    const name = prompt('请输入新菜品名称');
    if (!name) return;
    const price = parseInt(prompt('请输入价格（数字）', '0'));
    if (isNaN(price)) return;
    const emoji = prompt('请输入菜品图标（一个emoji，默认🍽️）', '🍽️');
    try {
        await axios.post('/api/dishes', { name, price, emoji: emoji || '🍽️' });
        await renderMerchantDishes();
        renderHomeContent();
    } catch (err) {
        alert('添加失败: ' + (err.response?.data?.error || err.message));
    }
});

// =====================================================
// 核心：渲染首页内容（根据当前角色）
// =====================================================
function renderHomeContent() {
    if (!currentUser) {
        // 未登录：显示点餐表单 + 登录区域
        homeContent.innerHTML = `
            <div class="card order-form">
                <h3>📝 新订单</h3>
                <input type="text" id="custName" placeholder="收货人姓名" autocomplete="off">
                <input type="tel" id="custPhone" placeholder="联系电话（将作为账号）" autocomplete="off">
                <textarea id="custAddress" rows="2" placeholder="详细地址" autocomplete="off"></textarea>
                
                <div id="dishList" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 12px; font-weight: 500;">请选择菜品（可多选）：</label>
                    <div id="dishOptionsContainer" style="display: flex; flex-direction: column; gap: 12px;"></div>
                </div>
                <button id="submitOrderBtn" class="btn primary">✅ 立即下单</button>
            </div>
            <div id="authArea" class="card">
                <h3>🔐 登录/注册</h3>
                <div id="loginForm">
                    <input type="tel" id="loginPhone" placeholder="手机号" autocomplete="off">
                    <input type="password" id="loginPassword" placeholder="密码">
                    <button id="doLoginBtn" class="btn primary">登录/注册</button>
                </div>
                <div id="authMessage" style="margin-top: 12px; font-size: 0.8rem; color: red;"></div>
            </div>
        `;
        bindHomeEvents();
        renderUserDishesToContainer();
        return;
    }

    // 已登录：根据角色显示不同首页
    const role = currentUser.role;
    if (role === 'customer') {
        homeContent.innerHTML = `
            <div class="card order-form">
                <h3>📝 新订单</h3>
                <input type="text" id="custName" placeholder="收货人姓名" autocomplete="off">
                <input type="tel" id="custPhone" placeholder="联系电话" autocomplete="off">
                <textarea id="custAddress" rows="2" placeholder="详细地址" autocomplete="off"></textarea>
                <div id="dishList" style="margin-bottom: 16px;">
                    <label style="display: block; margin-bottom: 12px; font-weight: 500;">请选择菜品（可多选）：</label>
                    <div id="dishOptionsContainer" style="display: flex; flex-direction: column; gap: 12px;"></div>
                </div>
                <button id="submitOrderBtn" class="btn primary">✅ 立即下单</button>
            </div>
        `;
        bindHomeEvents();
        renderUserDishesToContainer();
    } else if (role === 'merchant') {
        homeContent.innerHTML = `
            <div class="stats-badge">📊 未派送订单: <span id="undispatchedCount">0</span></div>
            <div class="card">
                <h3>🏪 所有订单</h3>
                <div id="merchantOrdersList" class="order-list"><div class="empty-tip">暂无订单</div></div>
            </div>
        `;
        loadMerchantOrders();
    } else if (role === 'courier') {
        homeContent.innerHTML = `
            <div class="stats-badge">🚚 待配送订单: <span id="deliveringCount">0</span></div>
            <div class="card">
                <h3>📬 配送任务</h3>
                <div id="courierOrdersList" class="order-list"><div class="empty-tip">暂无配送任务</div></div>
            </div>
        `;
        loadCourierOrders();
    }
}

// 绑定首页内的事件（下单、登录等）
function bindHomeEvents() {
    // 登录按钮
    const loginBtn = document.getElementById('doLoginBtn');
    if (loginBtn) {
        loginBtn.removeEventListener('click', handleLogin);
        loginBtn.addEventListener('click', handleLogin);
    }
    // 下单按钮
    const submitBtn = document.getElementById('submitOrderBtn');
    if (submitBtn) {
        submitBtn.removeEventListener('click', handleSubmitOrder);
        submitBtn.addEventListener('click', handleSubmitOrder);
    }
}

// 登录处理函数
async function handleLogin() {
    const phone = document.getElementById('loginPhone').value.trim();
    const password = document.getElementById('loginPassword').value;
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
        showAuthMessage('请输入11位有效手机号');
        return;
    }

    let registered = false, existingRole = null;
    try {
        const checkRes = await axios.post('/api/check-phone', { phone });
        registered = checkRes.data.registered;
        existingRole = checkRes.data.role;
    } catch (err) {
        showAuthMessage('网络错误，请稍后重试');
        return;
    }

    if (registered) {
        if (!password) {
            showAuthMessage('请输入密码');
            return;
        }
        try {
            const res = await axios.post('/api/login', { phone, password });
            currentUser = res.data;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage('登录成功', 'green');
            document.getElementById('loginPhone').value = '';
            document.getElementById('loginPassword').value = '';
            afterLogin();
        } catch (err) {
            showAuthMessage(err.response?.data?.error || '登录失败');
        }
    } else {
        // 未注册：弹窗选择身份
        const chosenRole = await showRoleModal();
        if (!chosenRole) return;
        if (chosenRole === 'customer') {
            const user = await autoRegister(phone, 'customer');
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage('注册并登录成功', 'green');
            document.getElementById('loginPhone').value = '';
            document.getElementById('loginPassword').value = '';
            afterLogin();
        } else if (chosenRole === 'merchant' || chosenRole === 'courier') {
            const inviteCode = prompt('请输入邀请码');
            if (inviteCode !== '5075') {
                alert('邀请码错误，请重新选择身份');
                return;
            }
            const user = await autoRegister(phone, chosenRole);
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage(`注册成功，欢迎${chosenRole === 'merchant' ? '商家' : '快递员'}`, 'green');
            document.getElementById('loginPhone').value = '';
            document.getElementById('loginPassword').value = '';
            afterLogin();
        }
    }
}

// 下单处理
async function handleSubmitOrder() {
    const customerName = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const address = document.getElementById('custAddress').value.trim();
    const selectedDishes = getSelectedDishes();
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
        alert('请输入11位有效手机号');
        return;
    }
    if (!customerName || !address || !selectedDishes) {
        alert('请完整填写收货信息并至少选择一道菜品');
        return;
    }

    // 检查是否已注册
    let registered = false, existingRole = null;
    try {
        const checkRes = await axios.post('/api/check-phone', { phone });
        registered = checkRes.data.registered;
        existingRole = checkRes.data.role;
    } catch (err) {
        alert('网络错误，请稍后重试');
        return;
    }

    if (!registered) {
        const chosenRole = await showRoleModal();
        if (!chosenRole) return;
        if (chosenRole === 'customer') {
            const user = await autoRegister(phone, 'customer');
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            afterLogin();
        } else if (chosenRole === 'merchant' || chosenRole === 'courier') {
            const inviteCode = prompt('请输入邀请码');
            if (inviteCode !== '5075') {
                alert('邀请码错误，请重新选择身份');
                return;
            }
            const user = await autoRegister(phone, chosenRole);
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            afterLogin();
            return; // 不提交订单
        }
    } else {
        if (existingRole !== 'customer') {
            alert('该手机号已注册为商家或快递员，无法下单。请使用用户账号。');
            return;
        }
        if (!currentUser || currentUser.phone !== phone) {
            const pwd = prompt('该手机号已注册，请输入密码登录：');
            if (!pwd) {
                alert('取消下单');
                return;
            }
            try {
                const loginRes = await axios.post('/api/login', { phone, password: pwd });
                currentUser = loginRes.data;
                localStorage.setItem('user', JSON.stringify(currentUser));
                afterLogin();
            } catch (err) {
                alert('密码错误，下单失败');
                return;
            }
        }
    }

    if (currentUser.role !== 'customer') {
        alert('当前账号不是普通用户，无法下单');
        return;
    }

    try {
        await axios.post('/api/orders', { customerName, address, phone, itemDesc: selectedDishes });
        document.getElementById('custName').value = '';
        document.getElementById('custPhone').value = '';
        document.getElementById('custAddress').value = '';
        document.querySelectorAll('.dish-checkbox').forEach(cb => {
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
        });
        if (currentTab === 'orders') await loadCustomerOrders();
        alert('下单成功！');
    } catch (err) {
        alert('下单失败: ' + (err.response?.data?.error || err.message));
    }
}

// =====================================================
// 通用辅助函数
// =====================================================
function showAuthMessage(msg, color = 'red') {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.innerText = msg;
    el.style.color = color;
    setTimeout(() => { if (el.innerText === msg) el.innerText = ''; }, 3000);
}

function showRoleModal() {
    return new Promise((resolve) => {
        modal.style.display = 'flex';
        const handler = (e) => {
            const roleDiv = e.target.closest('.role-option');
            if (!roleDiv) return;
            const role = roleDiv.dataset.role;
            modal.style.display = 'none';
            roleOptions.forEach(opt => opt.removeEventListener('click', handler));
            closeModalBtn.removeEventListener('click', closeHandler);
            resolve(role);
        };
        const closeHandler = () => {
            modal.style.display = 'none';
            roleOptions.forEach(opt => opt.removeEventListener('click', handler));
            closeModalBtn.removeEventListener('click', closeHandler);
            resolve(null);
        };
        roleOptions.forEach(opt => opt.addEventListener('click', handler));
        closeModalBtn.addEventListener('click', closeHandler);
    });
}

async function autoRegister(phone, role, password = null) {
    const finalPassword = password || phone.slice(-6);
    try {
        const res = await axios.post('/api/register', { phone, password: finalPassword, role });
        return res.data;
    } catch (err) {
        console.error(err);
        alert('注册失败: ' + (err.response?.data?.error || err.message));
        return null;
    }
}

function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m]; });
}
function formatDate(dateStr) {
    let d = new Date(dateStr);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// =====================================================
// 订单加载函数（用户、商家、快递员）
// =====================================================
async function loadCustomerOrders() {
    if (!currentUser || currentUser.role !== 'customer') return;
    try {
        const res = await axios.get('/api/orders');
        const orders = res.data;
        const container = document.getElementById('customerOrdersList');
        if (!container) return;
        if (!orders || orders.length === 0) {
            container.innerHTML = '<div class="empty-tip">✨ 暂无订单，快去下一单吧~</div>';
            return;
        }
        const statusMap = { pending: '待接单', accepted: '制作中', dispatched: '配送中', delivered: '已完成' };
        const html = orders.map(order => `
            <div class="order-item">
                <div class="order-header">
                    <span class="order-id">#${order.id}</span>
                    <span class="order-status status-${order.status}">${statusMap[order.status]}</span>
                </div>
                <div class="order-detail"><strong>🍽️ 菜品：</strong> ${escapeHtml(order.itemDesc)}</div>
                <div class="order-detail"><strong>📍 地址：</strong> ${escapeHtml(order.address)}</div>
                <div class="order-detail"><strong>👤 收货人：</strong> ${escapeHtml(order.customerName)} ${escapeHtml(order.phone)}</div>
                <div class="order-detail"><strong>🕒 下单：</strong> ${formatDate(order.createdAt)}</div>
            </div>
        `).join('');
        container.innerHTML = html;
    } catch (err) { console.error(err); }
}

async function loadMerchantOrders() {
    if (!currentUser || currentUser.role !== 'merchant') return;
    try {
        const res = await axios.get('/api/orders');
        const orders = res.data;
        const container = document.getElementById('merchantOrdersList');
        if (!container) return;
        if (!orders || orders.length === 0) {
            container.innerHTML = '<div class="empty-tip">暂无订单</div>';
        } else {
            const statusMap = { pending: '待接单', accepted: '制作中', dispatched: '配送中', delivered: '已完成' };
            const html = orders.map(order => {
                let actions = '';
                if (order.status === 'pending') actions = `<button class="btn small primary" data-action="accept" data-id="${order.id}">接单</button>`;
                else if (order.status === 'accepted') actions = `<button class="btn small warning" data-action="dispatch" data-id="${order.id}">制作完成并推送</button>`;
                else if (order.status === 'dispatched') actions = `<button class="btn small secondary" disabled>已推送快递员</button>`;
                else actions = `<span style="color:#27ae60;">已完成</span>`;
                return `<div class="order-item">
                    <div class="order-header"><span class="order-id">#${order.id}</span><span class="order-status status-${order.status}">${statusMap[order.status]}</span></div>
                    <div class="order-detail"><strong>菜品：</strong> ${escapeHtml(order.itemDesc)}</div>
                    <div class="order-detail"><strong>地址：</strong> ${escapeHtml(order.address)}</div>
                    <div class="order-detail"><strong>用户：</strong> ${escapeHtml(order.customerName)} / ${escapeHtml(order.phone)}</div>
                    <div class="order-actions">${actions}</div>
                </div>`;
            }).join('');
            container.innerHTML = html;
            document.querySelectorAll('[data-action="accept"]').forEach(btn => btn.addEventListener('click', async () => { await acceptOrder(btn.dataset.id); }));
            document.querySelectorAll('[data-action="dispatch"]').forEach(btn => btn.addEventListener('click', async () => { await dispatchOrder(btn.dataset.id); }));
        }
        const undispatched = orders ? orders.filter(o => o.status === 'dispatched').length : 0;
        const badge = document.getElementById('undispatchedCount');
        if (badge) badge.innerText = undispatched;
    } catch (err) { console.error(err); }
}

async function loadCourierOrders() {
    if (!currentUser || currentUser.role !== 'courier') return;
    try {
        const res = await axios.get('/api/orders');
        const orders = res.data;
        const container = document.getElementById('courierOrdersList');
        if (!container) return;
        if (!orders || orders.length === 0) {
            container.innerHTML = '<div class="empty-tip">暂无配送任务</div>';
        } else {
            const html = orders.map(order => `<div class="order-item">
                <div class="order-header"><span class="order-id">订单 #${order.id}</span><span class="order-status status-dispatched">待配送</span></div>
                <div class="courier-address"><strong>送达地址：</strong><br>${escapeHtml(order.address)}<br><strong>${escapeHtml(order.customerName)}</strong> ${escapeHtml(order.phone)}</div>
                <div class="order-detail"><strong>菜品：</strong> ${escapeHtml(order.itemDesc)}</div>
                <div class="order-actions"><button class="btn small success" data-complete="${order.id}">完成配送</button></div>
            </div>`).join('');
            container.innerHTML = html;
            document.querySelectorAll('[data-complete]').forEach(btn => btn.addEventListener('click', async () => { await completeOrder(btn.dataset.complete); }));
        }
        const badge = document.getElementById('deliveringCount');
        if (badge) badge.innerText = orders ? orders.length : 0;
    } catch (err) { console.error(err); }
}

async function acceptOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/accept`); loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}
async function dispatchOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/dispatch`); loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}
async function completeOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/complete`); loadCourierOrders(); loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}

// =====================================================
// 底部导航渲染
// =====================================================
function renderBottomNav() {
    let tabs = [];
    if (!currentUser) {
        tabs = [
            { id: 'home', label: '🏠 首页', panel: 'panelHome' },
            { id: 'profile', label: '👤 我的', panel: 'panelProfile' }
        ];
    } else if (currentUser.role === 'customer') {
        tabs = [
            { id: 'home', label: '🏠 首页', panel: 'panelHome' },
            { id: 'orders', label: '📋 我的订单', panel: 'panelOrders' },
            { id: 'profile', label: '👤 我的', panel: 'panelProfile' }
        ];
    } else if (currentUser.role === 'merchant') {
        tabs = [
            { id: 'home', label: '🏠 首页', panel: 'panelHome' },
            { id: 'dishes', label: '🍽️ 菜品管理', panel: 'panelDishes' },
            { id: 'profile', label: '👤 我的', panel: 'panelProfile' }
        ];
    } else if (currentUser.role === 'courier') {
        tabs = [
            { id: 'home', label: '🏠 首页', panel: 'panelHome' },
            { id: 'profile', label: '👤 我的', panel: 'panelProfile' }
        ];
    }

    bottomNav.innerHTML = tabs.map(t => `
        <button class="nav-item ${t.id === currentTab ? 'active' : ''}" data-tab="${t.id}" data-panel="${t.panel}">
            ${t.label}
        </button>
    `).join('');

    bottomNav.querySelectorAll('.nav-item').forEach(btn => {
        btn.addEventListener('click', () => {
            const tab = btn.dataset.tab;
            const panelId = btn.dataset.panel;
            bottomNav.querySelectorAll('.nav-item').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            document.querySelectorAll('#mainContent > .panel').forEach(p => p.style.display = 'none');
            document.getElementById(panelId).style.display = 'block';
            currentTab = tab;
            if (tab === 'orders' && currentUser?.role === 'customer') loadCustomerOrders();
            if (tab === 'dishes' && currentUser?.role === 'merchant') renderMerchantDishes();
            if (tab === 'profile') updateProfilePanel();
        });
    });
}

function updateProfilePanel() {
    if (!currentUser) {
        profilePhone.innerText = '未登录';
        profileRole.innerText = '游客';
        profileLogoutBtn.style.display = 'none';
        return;
    }
    profilePhone.innerText = currentUser.phone;
    const roleMap = { customer: '普通用户', merchant: '商家', courier: '快递员' };
    profileRole.innerText = roleMap[currentUser.role] || currentUser.role;
    profileLogoutBtn.style.display = 'block';
}

profileLogoutBtn.addEventListener('click', async () => {
    await axios.post('/api/logout');
    currentUser = null;
    localStorage.removeItem('user');
    afterLogin();
    document.querySelector('#bottomNav .nav-item[data-tab="home"]')?.click();
});

// =====================================================
// 登录成功后的统一处理
// =====================================================
function afterLogin() {
    renderHomeContent();
    renderBottomNav();
    if (currentUser?.role === 'customer') {
        loadCustomerOrders();
    }
    if (currentUser?.role === 'merchant') {
        renderMerchantDishes();
    }
    updateProfilePanel();
    document.querySelector('#bottomNav .nav-item[data-tab="home"]')?.click();
}

// =====================================================
// 自动登录检查
// =====================================================
async function checkAutoLogin() {
    const stored = localStorage.getItem('user');
    if (!stored) {
        renderHomeContent();
        renderBottomNav();
        updateProfilePanel();
        return;
    }
    try {
        const me = await axios.get('/api/me');
        currentUser = me.data;
        localStorage.setItem('user', JSON.stringify(currentUser));
    } catch (e) {
        localStorage.removeItem('user');
        currentUser = null;
    }
    afterLogin();
}

// =====================================================
// Socket 实时刷新
// =====================================================
socket.on('order-updated', () => {
    if (currentUser) {
        if (currentUser.role === 'customer' && currentTab === 'orders') loadCustomerOrders();
        if (currentUser.role === 'merchant') loadMerchantOrders();
        if (currentUser.role === 'courier') loadCourierOrders();
        if (currentTab === 'home') {
            if (currentUser.role === 'merchant') loadMerchantOrders();
            else if (currentUser.role === 'courier') loadCourierOrders();
        }
    }
});

// =====================================================
// 启动
// =====================================================
checkAutoLogin();