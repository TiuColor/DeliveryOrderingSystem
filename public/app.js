// 全局状态
let currentRole = 'customer';
let currentUser = null;
const socket = io();

// DOM 元素
const roleBtns = document.querySelectorAll('.role-btn');
const panels = {
    customer: document.getElementById('customerPanel'),
    merchant: document.getElementById('merchantPanel'),
    courier: document.getElementById('courierPanel')
};

// 用户面板内元素
const authArea = document.getElementById('authArea');
const myOrdersArea = document.getElementById('myOrdersArea');
const loginPhoneInput = document.getElementById('loginPhone');
const loginPasswordInput = document.getElementById('loginPassword');
const doLoginBtn = document.getElementById('doLoginBtn');
const authMessageSpan = document.getElementById('authMessage');
const logoutBtnCustomer = document.getElementById('logoutBtnCustomer');
const customerOrdersList = document.getElementById('customerOrdersList');

// 模态框
const modal = document.getElementById('roleModal');
const roleOptions = document.querySelectorAll('.role-option');
const closeModalBtn = document.getElementById('closeModalBtn');

// ========== 菜品相关 ==========
async function loadDishes() {
    try {
        const res = await axios.get('/api/dishes');
        return res.data;
    } catch (err) {
        console.error('加载菜品失败', err);
        return [];
    }
}

async function renderUserDishes() {
    const dishes = await loadDishes();
    const container = document.getElementById('dishOptionsContainer');
    if (!container) return;
    container.innerHTML = '';
    dishes.forEach(dish => {
        const div = document.createElement('div');
        div.className = 'dish-item';
        div.dataset.id = dish.id;
        div.innerHTML = `
            <label class="dish-checkbox">
                <input type="checkbox" value="${dish.emoji} ${dish.name}">
                <span class="dish-emoji">${dish.emoji}</span>
                <span class="dish-name">${dish.name}</span>
                <span class="dish-price">¥${dish.price}</span>
            </label>
            <div class="dish-quantity">
                <span>数量</span>
                <input type="number" min="1" value="1" class="qty-input" disabled>
            </div>
        `;
        const checkbox = div.querySelector('input[type="checkbox"]');
        const qtyInput = div.querySelector('.qty-input');
        checkbox.addEventListener('change', () => {
            qtyInput.disabled = !checkbox.checked;
            if (!checkbox.checked) qtyInput.value = 1;
        });
        container.appendChild(div);
    });
}

function getSelectedDishes() {
    const items = [];
    document.querySelectorAll('.dish-item').forEach(item => {
        const checkbox = item.querySelector('input[type="checkbox"]');
        if (checkbox && checkbox.checked) {
            const dishName = checkbox.value;
            const qty = item.querySelector('.qty-input').value;
            items.push(`${dishName} x${qty}`);
        }
    });
    return items.join(', ');
}

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
                await renderUserDishes();
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
                await renderUserDishes();
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
        await renderUserDishes();
    } catch (err) {
        alert('添加失败: ' + (err.response?.data?.error || err.message));
    }
});

// ========== 角色切换 ==========
roleBtns.forEach(btn => {
    btn.addEventListener('click', async () => {
        const role = btn.dataset.role;
        if (!role) return;
        if ((role === 'merchant' || role === 'courier') && !currentUser) {
            alert('请先以商家或快递员身份登录');
            document.querySelector('.role-btn[data-role="customer"]').click();
            return;
        }
        if ((role === 'merchant' && currentUser?.role !== 'merchant') ||
            (role === 'courier' && currentUser?.role !== 'courier')) {
            alert('权限不足，请使用正确的账号登录');
            return;
        }
        roleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        Object.values(panels).forEach(p => p.classList.remove('active'));
        panels[role].classList.add('active');
        currentRole = role;
        if (role === 'merchant') {
            await loadMerchantOrders();
            await renderMerchantDishes();
        } else if (role === 'courier') {
            await loadCourierOrders();
        }
    });
});

// ========== 用户相关 UI ==========
function showAuthMessage(msg, color = 'red') {
    authMessageSpan.innerText = msg;
    authMessageSpan.style.color = color;
    setTimeout(() => { if (authMessageSpan.innerText === msg) authMessageSpan.innerText = ''; }, 3000);
}

function updateCustomerUI() {
    if (currentUser && currentUser.role === 'customer') {
        authArea.style.display = 'none';
        myOrdersArea.style.display = 'block';
        loadCustomerOrders();
    } else {
        authArea.style.display = 'block';
        myOrdersArea.style.display = 'none';
    }
}

async function loadCustomerOrders() {
    if (!currentUser || currentUser.role !== 'customer') return;
    try {
        const res = await axios.get('/api/orders');
        renderCustomerOrders(res.data);
    } catch (err) { console.error(err); }
}

function renderCustomerOrders(orders) {
    if (!orders || orders.length === 0) {
        customerOrdersList.innerHTML = '<div class="empty-tip">✨ 暂无订单，快去下一单吧~</div>';
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
    customerOrdersList.innerHTML = html;
}

// ========== 身份选择弹窗 ==========
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

// 自动注册（不自动登录，返回用户对象）
async function autoRegister(phone, role, password = null) {
    const finalPassword = password || phone.slice(-6);
    try {
        const res = await axios.post('/api/register', { phone, password: finalPassword, role });
        return res.data; // { id, phone, role }
    } catch (err) {
        console.error(err);
        alert('注册失败: ' + (err.response?.data?.error || err.message));
        return null;
    }
}

// ========== 登录/注册按钮逻辑（核心修改） ==========
doLoginBtn.addEventListener('click', async () => {
    const phone = loginPhoneInput.value.trim();
    const password = loginPasswordInput.value;
    // 手机号格式验证
    const phoneRegex = /^1[3-9]\d{9}$/;
    if (!phoneRegex.test(phone)) {
        showAuthMessage('请输入11位有效手机号');
        return;
    }

    // 检查是否已注册
    let registered = false;
    let existingRole = null;
    try {
        const checkRes = await axios.post('/api/check-phone', { phone });
        registered = checkRes.data.registered;
        existingRole = checkRes.data.role;
    } catch (err) {
        showAuthMessage('网络错误，请稍后重试');
        return;
    }

    if (registered) {
        // 已注册：正常登录
        if (!password) {
            showAuthMessage('请输入密码');
            return;
        }
        try {
            const res = await axios.post('/api/login', { phone, password });
            currentUser = res.data;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage('登录成功', 'green');
            loginPhoneInput.value = '';
            loginPasswordInput.value = '';
            // 根据角色跳转
            if (currentUser.role === 'customer') {
                updateCustomerUI();
                if (currentRole !== 'customer') document.querySelector('.role-btn[data-role="customer"]').click();
            } else if (currentUser.role === 'merchant') {
                document.querySelector('.role-btn[data-role="merchant"]').click();
            } else if (currentUser.role === 'courier') {
                document.querySelector('.role-btn[data-role="courier"]').click();
            }
        } catch (err) {
            showAuthMessage(err.response?.data?.error || '登录失败');
        }
    } else {
        // 未注册：弹出身份选择弹窗
        const chosenRole = await showRoleModal();
        if (!chosenRole) return; // 用户取消

        if (chosenRole === 'customer') {
            // 自动注册普通用户
            const user = await autoRegister(phone, 'customer');
            if (!user) return;
            // 注册成功后自动登录
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage('注册并登录成功', 'green');
            loginPhoneInput.value = '';
            loginPasswordInput.value = '';
            updateCustomerUI();
            if (currentRole !== 'customer') document.querySelector('.role-btn[data-role="customer"]').click();
        } else if (chosenRole === 'merchant' || chosenRole === 'courier') {
            // 商家/快递员需要邀请码
            const inviteCode = prompt('请输入邀请码');  // 不显示具体数字
            if (inviteCode !== '5075') {
                alert('邀请码错误，请重新选择身份');
                // 重新显示身份选择弹窗（递归调用当前逻辑，但为避免嵌套过深，直接重新执行登录流程）
                // 简单方式：重新触发登录按钮点击事件？但会导致循环。我们手动再次显示弹窗。
                // 为了简洁，这里直接返回，用户可再次点击登录按钮
                return;
            }
            const user = await autoRegister(phone, chosenRole);
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            showAuthMessage(`注册并登录成功，欢迎${chosenRole === 'merchant' ? '商家' : '快递员'}`, 'green');
            loginPhoneInput.value = '';
            loginPasswordInput.value = '';
            // 跳转到对应后台
            if (chosenRole === 'merchant') {
                document.querySelector('.role-btn[data-role="merchant"]').click();
            } else {
                document.querySelector('.role-btn[data-role="courier"]').click();
            }
        }
    }
});

// 退出登录
logoutBtnCustomer.addEventListener('click', async () => {
    await axios.post('/api/logout');
    currentUser = null;
    localStorage.removeItem('user');
    updateCustomerUI();
    showAuthMessage('已退出登录');
    if (currentRole !== 'customer') document.querySelector('.role-btn[data-role="customer"]').click();
});

// ========== 下单逻辑（保持不变，但注意登录状态） ==========
document.getElementById('submitOrderBtn').addEventListener('click', async () => {
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

    // 检查是否已注册（下单时也需要，但此时可能未登录）
    let registered = false;
    let existingRole = null;
    try {
        const checkRes = await axios.post('/api/check-phone', { phone });
        registered = checkRes.data.registered;
        existingRole = checkRes.data.role;
    } catch (err) {
        alert('网络错误，请稍后重试');
        return;
    }

    if (!registered) {
        // 未注册：弹出身份选择
        const chosenRole = await showRoleModal();
        if (!chosenRole) return;
        if (chosenRole === 'customer') {
            const user = await autoRegister(phone, 'customer');
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            updateCustomerUI();
            showAuthMessage('注册并登录成功，正在提交订单', 'green');
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
            // 跳转到对应后台，不提交订单
            if (chosenRole === 'merchant') {
                document.querySelector('.role-btn[data-role="merchant"]').click();
            } else {
                document.querySelector('.role-btn[data-role="courier"]').click();
            }
            return;
        }
    } else {
        // 已注册，但可能未登录（比如下单的手机号与当前登录的不同，或未登录）
        if (existingRole !== 'customer') {
            alert('该手机号已注册为商家或快递员，无法下单。请使用用户账号。');
            return;
        }
        // 如果当前未登录或登录的不是该手机号，需要登录
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
                updateCustomerUI();
                showAuthMessage('登录成功', 'green');
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
        document.querySelectorAll('.dish-item input[type="checkbox"]').forEach(cb => {
            cb.checked = false;
            cb.dispatchEvent(new Event('change'));
        });
        await loadCustomerOrders();
        alert('下单成功！');
    } catch (err) {
        alert('下单失败: ' + (err.response?.data?.error || err.message));
    }
});

// ========== 商家订单相关 ==========
async function loadMerchantOrders() {
    if (!currentUser || currentUser.role !== 'merchant') return;
    try {
        const res = await axios.get('/api/orders');
        const orders = res.data;
        renderMerchantOrders(orders);
        const undispatched = orders.filter(o => o.status === 'dispatched').length;
        document.getElementById('undispatchedCount').innerText = undispatched;
    } catch (err) { console.error(err); }
}

function renderMerchantOrders(orders) {
    const container = document.getElementById('merchantOrdersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无订单</div>';
        return;
    }
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

async function acceptOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/accept`); if (currentRole === 'merchant') await loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}
async function dispatchOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/dispatch`); if (currentRole === 'merchant') await loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}

// ========== 快递员相关 ==========
async function loadCourierOrders() {
    if (!currentUser || currentUser.role !== 'courier') return;
    try {
        const res = await axios.get('/api/orders');
        const orders = res.data;
        renderCourierOrders(orders);
        document.getElementById('deliveringCount').innerText = orders.length;
    } catch (err) { console.error(err); }
}

function renderCourierOrders(orders) {
    const container = document.getElementById('courierOrdersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-tip">暂无配送任务</div>';
        return;
    }
    const html = orders.map(order => `<div class="order-item">
        <div class="order-header"><span class="order-id">订单 #${order.id}</span><span class="order-status status-dispatched">待配送</span></div>
        <div class="courier-address"><strong>送达地址：</strong><br>${escapeHtml(order.address)}<br><strong>${escapeHtml(order.customerName)}</strong> ${escapeHtml(order.phone)}</div>
        <div class="order-detail"><strong>菜品：</strong> ${escapeHtml(order.itemDesc)}</div>
        <div class="order-actions"><button class="btn small success" data-complete="${order.id}">完成配送</button></div>
    </div>`).join('');
    container.innerHTML = html;
    document.querySelectorAll('[data-complete]').forEach(btn => btn.addEventListener('click', async () => { await completeOrder(btn.dataset.complete); }));
}

async function completeOrder(orderId) {
    try { await axios.post(`/api/orders/${orderId}/complete`); if (currentRole === 'courier') await loadCourierOrders(); if (currentRole === 'merchant') await loadMerchantOrders(); } catch (err) { alert('操作失败'); }
}

// ========== 辅助函数 ==========
function escapeHtml(str) { 
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;' }[m]; }); 
}
function formatDate(dateStr) { 
    let d = new Date(dateStr); 
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`; 
}

// 自动登录检查
async function checkAutoLogin() {
    const stored = localStorage.getItem('user');
    if (!stored) return;
    try {
        const me = await axios.get('/api/me');
        currentUser = me.data;
        if (currentUser.role === 'customer') {
            updateCustomerUI();
            if (currentRole !== 'customer') document.querySelector('.role-btn[data-role="customer"]').click();
        } else if (currentUser.role === 'merchant') {
            document.querySelector('.role-btn[data-role="merchant"]').click();
        } else if (currentUser.role === 'courier') {
            document.querySelector('.role-btn[data-role="courier"]').click();
        }
    } catch (e) {
        localStorage.removeItem('user');
        currentUser = null;
        updateCustomerUI();
    }
}

// Socket 实时刷新
socket.on('order-updated', () => {
    if (currentRole === 'customer' && currentUser?.role === 'customer') loadCustomerOrders();
    if (currentRole === 'merchant' && currentUser?.role === 'merchant') loadMerchantOrders();
    if (currentRole === 'courier' && currentUser?.role === 'courier') loadCourierOrders();
});

// 初始化
renderUserDishes();
checkAutoLogin();
updateCustomerUI();