// public/app.js
// 全局状态
let currentRole = 'customer';   // customer, merchant, courier
let currentUserId = localStorage.getItem('userId');
if (!currentUserId) {
    currentUserId = generateUUID();
    localStorage.setItem('userId', currentUserId);
}

// Socket 连接
const socket = io();

// 辅助函数
function generateUUID() {
    return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
        const r = Math.random() * 16 | 0;
        const v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
    });
}

// 角色切换逻辑
const roleBtns = document.querySelectorAll('.role-btn');
const panels = {
    customer: document.getElementById('customerPanel'),
    merchant: document.getElementById('merchantPanel'),
    courier: document.getElementById('courierPanel')
};

roleBtns.forEach(btn => {
    btn.addEventListener('click', () => {
        const role = btn.dataset.role;
        if (!role) return;
        // 更新按钮样式
        roleBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        // 切换面板
        Object.values(panels).forEach(panel => panel.classList.remove('active'));
        panels[role].classList.add('active');
        currentRole = role;
        // 重新加载对应数据
        loadDataByRole();
    });
});

// 数据加载分发
async function loadDataByRole() {
    if (currentRole === 'customer') {
        await loadCustomerOrders();
    } else if (currentRole === 'merchant') {
        await loadMerchantOrders();
    } else if (currentRole === 'courier') {
        await loadCourierOrders();
    }
}

// 用户端: 加载我的订单
async function loadCustomerOrders() {
    try {
        const res = await axios.get(`/api/orders?userId=${currentUserId}`);
        const orders = res.data;
        renderCustomerOrders(orders);
    } catch (err) {
        console.error('加载用户订单失败', err);
    }
}

function renderCustomerOrders(orders) {
    const container = document.getElementById('customerOrdersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-tip">✨ 暂无订单，快去下一单吧~</div>';
        return;
    }
    const statusMap = {
        'pending': '待接单',
        'accepted': '制作中',
        'dispatched': '配送中',
        'delivered': '已完成'
    };
    const html = orders.map(order => `
        <div class="order-item">
            <div class="order-header">
                <span class="order-id">#${order.id}</span>
                <span class="order-status status-${order.status}">${statusMap[order.status]}</span>
            </div>
            <div class="order-detail"><strong>📦 商品：</strong> ${escapeHtml(order.itemDesc)}</div>
            <div class="order-detail"><strong>📍 地址：</strong> ${escapeHtml(order.address)}</div>
            <div class="order-detail"><strong>👤 联系人：</strong> ${escapeHtml(order.customerName)} ${escapeHtml(order.phone)}</div>
            <div class="order-detail"><strong>🕒 下单时间：</strong> ${formatDate(order.createdAt)}</div>
        </div>
    `).join('');
    container.innerHTML = html;
}

// 商家端加载订单
async function loadMerchantOrders() {
    try {
        const res = await axios.get('/api/orders?role=merchant');
        const orders = res.data;
        renderMerchantOrders(orders);
        // 计算未派送数量 (dispatched)
        const undispatched = orders.filter(o => o.status === 'dispatched').length;
        document.getElementById('undispatchedCount').innerText = undispatched;
    } catch (err) {
        console.error('商家加载订单失败', err);
    }
}

function renderMerchantOrders(orders) {
    const container = document.getElementById('merchantOrdersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-tip">🏪 暂无订单，等待用户下单~</div>';
        return;
    }
    const statusMap = {
        'pending': '待接单',
        'accepted': '制作中',
        'dispatched': '配送中',
        'delivered': '已完成'
    };
    const html = orders.map(order => {
        let actions = '';
        if (order.status === 'pending') {
            actions = `<button class="btn small primary" data-action="accept" data-id="${order.id}">✅ 接单</button>`;
        } else if (order.status === 'accepted') {
            actions = `<button class="btn small warning" data-action="dispatch" data-id="${order.id}">📤 制作完成并推送快递员</button>`;
        } else if (order.status === 'dispatched') {
            actions = `<button class="btn small secondary" disabled style="opacity:0.6">🚚 已推送给快递员</button>`;
        } else {
            actions = `<span style="font-size:0.7rem; color:#27ae60;">✅ 已完成</span>`;
        }
        return `
            <div class="order-item" data-order-id="${order.id}">
                <div class="order-header">
                    <span class="order-id">#${order.id}</span>
                    <span class="order-status status-${order.status}">${statusMap[order.status]}</span>
                </div>
                <div class="order-detail"><strong>📦 商品：</strong> ${escapeHtml(order.itemDesc)}</div>
                <div class="order-detail"><strong>📍 地址：</strong> ${escapeHtml(order.address)}</div>
                <div class="order-detail"><strong>👤 用户：</strong> ${escapeHtml(order.customerName)} / ${escapeHtml(order.phone)}</div>
                <div class="order-actions">
                    ${actions}
                </div>
            </div>
        `;
    }).join('');
    container.innerHTML = html;
    // 绑定按钮事件
    document.querySelectorAll('[data-action="accept"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await acceptOrder(id);
        });
    });
    document.querySelectorAll('[data-action="dispatch"]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            e.stopPropagation();
            const id = btn.dataset.id;
            await dispatchOrder(id);
        });
    });
}

// 快递员端加载
async function loadCourierOrders() {
    try {
        const res = await axios.get('/api/orders?role=courier');
        const orders = res.data;
        renderCourierOrders(orders);
        document.getElementById('deliveringCount').innerText = orders.length;
    } catch (err) {
        console.error('快递员加载失败', err);
    }
}

function renderCourierOrders(orders) {
    const container = document.getElementById('courierOrdersList');
    if (!orders || orders.length === 0) {
        container.innerHTML = '<div class="empty-tip">📭 暂无配送任务，等待商家推送</div>';
        return;
    }
    const html = orders.map(order => `
        <div class="order-item">
            <div class="order-header">
                <span class="order-id">订单 #${order.id}</span>
                <span class="order-status status-dispatched">待配送</span>
            </div>
            <div class="courier-address">
                <strong>🏠 送达地址：</strong><br>
                ${escapeHtml(order.address)}<br>
                <strong>👤 ${escapeHtml(order.customerName)}</strong> &nbsp; ${escapeHtml(order.phone)}
            </div>
            <div class="order-detail"><strong>📦 商品：</strong> ${escapeHtml(order.itemDesc)}</div>
            <div class="order-actions">
                <button class="btn small success" data-complete="${order.id}">✅ 完成配送</button>
            </div>
        </div>
    `).join('');
    container.innerHTML = html;
    // 绑定完成按钮
    document.querySelectorAll('[data-complete]').forEach(btn => {
        btn.addEventListener('click', async (e) => {
            const orderId = btn.dataset.complete;
            await completeOrder(orderId);
        });
    });
}

// API 调用
async function acceptOrder(orderId) {
    try {
        await axios.post(`/api/orders/${orderId}/accept`);
        // 成功后刷新商家视图
        if (currentRole === 'merchant') await loadMerchantOrders();
    } catch (err) {
        alert('接单失败: ' + (err.response?.data?.error || err.message));
    }
}

async function dispatchOrder(orderId) {
    try {
        await axios.post(`/api/orders/${orderId}/dispatch`);
        if (currentRole === 'merchant') await loadMerchantOrders();
    } catch (err) {
        alert('推送失败: ' + (err.response?.data?.error || err.message));
    }
}

async function completeOrder(orderId) {
    try {
        await axios.post(`/api/orders/${orderId}/complete`);
        if (currentRole === 'courier') await loadCourierOrders();
        // 如果商家界面开着，自动刷新显示完成状态
        if (currentRole === 'merchant') await loadMerchantOrders();
        if (currentRole === 'customer') await loadCustomerOrders();
    } catch (err) {
        alert('完成配送失败: ' + (err.response?.data?.error || err.message));
    }
}

// 用户下单
document.getElementById('submitOrderBtn')?.addEventListener('click', async () => {
    const customerName = document.getElementById('custName').value.trim();
    const phone = document.getElementById('custPhone').value.trim();
    const address = document.getElementById('custAddress').value.trim();
    const itemDesc = document.getElementById('itemDesc').value.trim();
    if (!customerName || !phone || !address || !itemDesc) {
        alert('请完整填写收货信息及商品描述');
        return;
    }
    try {
        await axios.post('/api/orders', {
            userId: currentUserId,
            customerName,
            phone,
            address,
            itemDesc
        });
        // 清空表单
        document.getElementById('custName').value = '';
        document.getElementById('custPhone').value = '';
        document.getElementById('custAddress').value = '';
        document.getElementById('itemDesc').value = '';
        // 刷新用户订单列表
        await loadCustomerOrders();
        // 如果当前是商家视图，实时刷新商家列表（让商家看到新订单）
        if (currentRole === 'merchant') await loadMerchantOrders();
        alert('下单成功！');
    } catch (err) {
        alert('下单失败: ' + (err.response?.data?.error || err.message));
    }
});

// 辅助函数
function escapeHtml(str) {
    if (!str) return '';
    return str.replace(/[&<>]/g, function(m) {
        if (m === '&') return '&amp;';
        if (m === '<') return '&lt;';
        if (m === '>') return '&gt;';
        return m;
    });
}

function formatDate(dateStr) {
    if (!dateStr) return '';
    const d = new Date(dateStr);
    return `${d.getMonth()+1}/${d.getDate()} ${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
}

// Socket 实时刷新
socket.on('order-updated', () => {
    loadDataByRole();
});

// 初始化加载用户订单
loadCustomerOrders();