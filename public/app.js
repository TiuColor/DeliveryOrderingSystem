// =====================================================
// 全局状态
// =====================================================
let currentUser = null;
let currentTab = 'home';
const socket = io();

// DOM 引用
const homeContent = document.getElementById('homeContent');
const panelHome = document.getElementById('panelHome');
const panelOrders = document.getElementById('panelOrders');
const panelDishes = document.getElementById('panelDishes');
const panelProfile = document.getElementById('panelProfile');
const bottomNav = document.getElementById('bottomNav');
const profileContent = document.getElementById('profileContent');

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

// 更新合计
function updateTotal() {
    const items = document.querySelectorAll('.dish-item');
    let total = 0;
    items.forEach(item => {
        const qtySpan = item.querySelector('.dish-qty-num');
        if (qtySpan) {
            const qty = parseInt(qtySpan.textContent) || 0;
            const price = parseFloat(item.dataset.price) || 0;
            total += price * qty;
        }
    });
    const totalEl = document.getElementById('dishTotal');
    if (totalEl) {
        totalEl.textContent = `合计：¥${total.toFixed(2)}`;
    }
}

// 渲染菜品列表（加减按钮风格，无复选框）
async function renderUserDishesToContainer() {
    const container = document.getElementById('dishOptionsContainer');
    if (!container) return;
    const dishes = await loadDishes();
    container.innerHTML = '';
    dishes.forEach(dish => {
        const div = document.createElement('div');
        div.className = 'dish-item';
        div.dataset.id = dish.id;
        div.dataset.price = dish.price;
        div.innerHTML = `
            <div class="dish-info">
                <span class="dish-emoji">${dish.emoji}</span>
                <span class="dish-name">${dish.name}</span>
                <span class="dish-price">¥${dish.price}</span>
            </div>
            <div class="dish-control">
                <button class="dish-btn dish-minus" style="display:none;">−</button>
                <span class="dish-qty-num" style="display:none;">0</span>
                <button class="dish-btn dish-plus">+</button>
            </div>
        `;

        const minusBtn = div.querySelector('.dish-minus');
        const qtySpan = div.querySelector('.dish-qty-num');
        const plusBtn = div.querySelector('.dish-plus');
        let quantity = 0;

        const updateDisplay = () => {
            if (quantity === 0) {
                minusBtn.style.display = 'none';
                qtySpan.style.display = 'none';
                plusBtn.textContent = '+';
            } else {
                minusBtn.style.display = 'inline-block';
                qtySpan.style.display = 'inline-block';
                qtySpan.textContent = quantity;
                plusBtn.textContent = '+';
            }
            updateTotal();
        };

        plusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            quantity += 1;
            updateDisplay();
        });
        minusBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            if (quantity > 0) {
                quantity -= 1;
                updateDisplay();
            }
        });

        container.appendChild(div);
    });
    // 合计行
    const totalDiv = document.createElement('div');
    totalDiv.className = 'dish-total';
    totalDiv.id = 'dishTotal';
    totalDiv.textContent = '合计：¥0.00';
    container.appendChild(totalDiv);
    updateTotal();
}

// 获取选中的菜品字符串
function getSelectedDishes() {
    const items = [];
    document.querySelectorAll('.dish-item').forEach(item => {
        const qtySpan = item.querySelector('.dish-qty-num');
        if (qtySpan) {
            const qty = parseInt(qtySpan.textContent) || 0;
            if (qty > 0) {
                const dishName = item.querySelector('.dish-name').textContent;
                const emoji = item.querySelector('.dish-emoji').textContent;
                items.push(`${emoji} ${dishName} x${qty}`);
            }
        }
    });
    return items.join(', ');
}

// 商家渲染菜品管理（行内编辑，添加和保存逻辑修改）
async function renderMerchantDishes() {
    if (!currentUser || currentUser.role !== 'merchant') return;
    const dishes = await loadDishes();
    const container = document.getElementById('dishManagementList');
    if (!container) return;
    
    // 构建菜品编辑行
    let html = '';
    if (dishes.length === 0) {
        html = '<div class="empty-tip">暂无菜品，请点击下方添加</div>';
    } else {
        html = dishes.map(dish => `
            <div class="dish-manage-item" data-id="${dish.id}">
                <div class="dish-manage-fields">
                    <input type="text" class="dish-name-input" value="${escapeHtml(dish.name)}" placeholder="菜名">
                    <input type="number" class="dish-price-input" value="${dish.price}" placeholder="价格">
                    <input type="text" class="dish-emoji-input" value="${dish.emoji}" placeholder="emoji" maxlength="2">
                </div>
                <div class="dish-manage-actions">
                    <button class="btn small delete-dish-btn" style="background:#e74c3c;">删除</button>
                </div>
            </div>
        `).join('');
    }
    container.innerHTML = html;
    
    // 绑定删除事件（每个行内删除）
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

// 统一保存所有菜品修改
async function saveAllDishes() {
    const items = document.querySelectorAll('.dish-manage-item');
    const updates = [];
    items.forEach(item => {
        const id = item.dataset.id;
        const name = item.querySelector('.dish-name-input').value.trim();
        const price = parseInt(item.querySelector('.dish-price-input').value);
        const emoji = item.querySelector('.dish-emoji-input').value.trim() || '🍽️';
        if (name && !isNaN(price)) {
            updates.push({ id, name, price, emoji });
        }
    });
    if (updates.length === 0) {
        alert('没有有效的菜品数据可保存');
        return;
    }
    try {
        // 逐个更新
        for (let dish of updates) {
            await axios.put(`/api/dishes/${dish.id}`, { name: dish.name, price: dish.price, emoji: dish.emoji });
        }
        alert('所有菜品保存成功');
        await renderMerchantDishes();
        renderHomeContent(); // 更新用户点餐界面
    } catch (err) {
        alert('保存失败: ' + (err.response?.data?.error || err.message));
    }
}

// 添加新菜品（直接新增一行）
async function addNewDishRow() {
    const container = document.getElementById('dishManagementList');
    if (!container) return;
    // 创建一个临时菜品对象（id为临时，保存时后端会创建）
    const newId = 'new_' + Date.now(); // 临时id
    const newRow = document.createElement('div');
    newRow.className = 'dish-manage-item';
    newRow.dataset.id = newId;
    newRow.innerHTML = `
        <div class="dish-manage-fields">
            <input type="text" class="dish-name-input" placeholder="新菜名" value="">
            <input type="number" class="dish-price-input" placeholder="价格" value="">
            <input type="text" class="dish-emoji-input" placeholder="emoji" value="🍽️" maxlength="2">
        </div>
        <div class="dish-manage-actions">
            <button class="btn small delete-dish-btn" style="background:#e74c3c;">删除</button>
        </div>
    `;
    // 移除空提示
    const emptyTip = container.querySelector('.empty-tip');
    if (emptyTip) emptyTip.remove();
    container.appendChild(newRow);
    // 绑定删除事件
    const deleteBtn = newRow.querySelector('.delete-dish-btn');
    deleteBtn.addEventListener('click', async (e) => {
        // 如果是临时行，直接移除
        if (newRow.dataset.id.startsWith('new_')) {
            newRow.remove();
            // 如果容器为空，显示空提示
            if (container.children.length === 0) {
                container.innerHTML = '<div class="empty-tip">暂无菜品，请点击下方添加</div>';
            }
            return;
        }
        // 否则调用删除API
        if (!confirm('确定删除此菜品吗？')) return;
        const id = newRow.dataset.id;
        try {
            await axios.delete(`/api/dishes/${id}`);
            alert('删除成功');
            await renderMerchantDishes();
            renderHomeContent();
        } catch (err) {
            alert('删除失败: ' + (err.response?.data?.error || err.message));
        }
    });
    // 聚焦到第一个输入框
    newRow.querySelector('.dish-name-input').focus();
}

// 事件绑定：保存所有按钮和添加按钮
document.addEventListener('DOMContentLoaded', () => {
    // 添加菜品按钮
    const addBtn = document.getElementById('addDishBtn');
    if (addBtn) {
        addBtn.removeEventListener('click', addNewDishRow);
        addBtn.addEventListener('click', addNewDishRow);
    }
    // 保存所有按钮
    const saveBtn = document.getElementById('saveAllDishesBtn');
    if (saveBtn) {
        saveBtn.removeEventListener('click', saveAllDishes);
        saveBtn.addEventListener('click', saveAllDishes);
    }
});

// 因为之前已经绑定了，但页面加载时可能已存在，所以在函数外部重新绑定，但为了保险，在afterLogin和切换商家面板时也重新绑定。
// 我们在 renderMerchantDishes 之后重新绑定一次，但注意不要重复绑定，使用一次性绑定。
// 我们可以在第一次渲染后绑定，但最好在每次商家面板激活时绑定。

// =====================================================
// 首页渲染（不含登录/注册）
// =====================================================
function renderHomeContent() {
    homeContent.innerHTML = `
        <div class="card order-form">
            <h3>📝 新订单</h3>
            <input type="text" id="custName" placeholder="收货人姓名" autocomplete="off">
            <input type="tel" id="custPhone" placeholder="联系电话（首次使用将作为账号）" autocomplete="off">
            <textarea id="custAddress" rows="1" placeholder="详细地址" autocomplete="off" style="resize: vertical; min-height: 44px;"></textarea>
            <div id="dishList" style="margin-bottom: 16px;">
                <label style="display: block; margin-bottom: 12px; font-weight: 500;">请选择菜品（可多选）：</label>
                <div id="dishOptionsContainer" style="display: flex; flex-direction: column; gap: 12px;"></div>
            </div>
            <button id="submitOrderBtn" class="btn primary">✅ 立即下单</button>
        </div>
    `;
    bindHomeEvents();
    renderUserDishesToContainer();
}

function bindHomeEvents() {
    const submitBtn = document.getElementById('submitOrderBtn');
    if (submitBtn) {
        submitBtn.removeEventListener('click', handleSubmitOrder);
        submitBtn.addEventListener('click', handleSubmitOrder);
    }
}

// =====================================================
// 我的面板渲染（含登录/注册、修改密码入口）
// =====================================================
function renderProfilePanel(showPwd = false) {
    if (!currentUser) {
        // 未登录：显示登录/注册表单
        profileContent.innerHTML = `
            <div id="authArea">
                <h4>🔐 登录/注册</h4>
                <div id="loginForm">
                    <input type="tel" id="loginPhone" placeholder="手机号" autocomplete="off">
                    <input type="password" id="loginPassword" placeholder="密码">
                    <button id="doLoginBtn" class="btn primary">登录/注册</button>
                </div>
                <div id="authMessage" style="margin-top: 12px; font-size: 0.8rem; color: red;"></div>
            </div>
        `;
        const loginBtn = document.getElementById('doLoginBtn');
        if (loginBtn) {
            loginBtn.removeEventListener('click', handleLogin);
            loginBtn.addEventListener('click', handleLogin);
        }
        return;
    }

    // 已登录：显示用户信息
    const roleMap = { customer: '普通用户', merchant: '商家', courier: '快递员' };
    
    if (showPwd) {
        // 显示修改密码详情页面
        profileContent.innerHTML = `
            <div id="profileInfoCompact">
                <p><strong>手机号：</strong>${escapeHtml(currentUser.phone)}</p>
                <p><strong>角色：</strong>${roleMap[currentUser.role] || currentUser.role}</p>
            </div>
            <div id="changePasswordArea" style="margin-top: 16px; border-top: 1px solid #eee; padding-top: 16px;">
                <h4>🔑 修改密码</h4>
                <p style="font-size: 0.8rem; color: #888;">新密码需包含数字、大小写字母中的至少两种，长度≥6位</p>
                <input type="password" id="newPasswordInput" placeholder="新密码" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd; margin-bottom:8px;">
                <input type="password" id="confirmPasswordInput" placeholder="确认新密码" style="width:100%; padding:10px; border-radius:8px; border:1px solid #ddd; margin-bottom:8px;">
                <button id="changePasswordBtn" class="btn primary" style="margin-top:4px;">确认修改</button>
                <div id="changePwdMsg" style="margin-top:8px; font-size:0.8rem; color:red;"></div>
            </div>
            <button id="backToProfileBtn" class="btn small" style="margin-top:12px; background:#ccc;">返回</button>
            <button id="profileLogoutBtn" class="btn secondary" style="margin-top:8px;">退出登录</button>
        `;
        // 绑定返回事件
        const backBtn = document.getElementById('backToProfileBtn');
        if (backBtn) {
            backBtn.removeEventListener('click', () => renderProfilePanel(false));
            backBtn.addEventListener('click', () => renderProfilePanel(false));
        }
        // 绑定修改密码事件
        const changeBtn = document.getElementById('changePasswordBtn');
        if (changeBtn) {
            changeBtn.removeEventListener('click', handleChangePassword);
            changeBtn.addEventListener('click', handleChangePassword);
        }
        // 绑定退出事件
        const logoutBtn = document.getElementById('profileLogoutBtn');
        if (logoutBtn) {
            logoutBtn.removeEventListener('click', handleLogout);
            logoutBtn.addEventListener('click', handleLogout);
        }
    } else {
        // 显示概要信息 + 修改密码入口
        profileContent.innerHTML = `
            <div id="profileInfo">
                <p><strong>手机号：</strong>${escapeHtml(currentUser.phone)}</p>
                <p><strong>角色：</strong>${roleMap[currentUser.role] || currentUser.role}</p>
            </div>
            <button id="goToChangePwdBtn" class="btn primary" style="margin-top:16px;">修改密码</button>
            <button id="profileLogoutBtn" class="btn secondary" style="margin-top:12px;">退出登录</button>
        `;
        // 绑定“修改密码”按钮事件
        const goBtn = document.getElementById('goToChangePwdBtn');
        if (goBtn) {
            goBtn.removeEventListener('click', () => renderProfilePanel(true));
            goBtn.addEventListener('click', () => renderProfilePanel(true));
        }
        // 绑定退出事件
        const logoutBtn = document.getElementById('profileLogoutBtn');
        if (logoutBtn) {
            logoutBtn.removeEventListener('click', handleLogout);
            logoutBtn.addEventListener('click', handleLogout);
        }
    }
}

// =====================================================
// 事件处理函数
// =====================================================
function showAuthMessage(msg, color = 'red') {
    const el = document.getElementById('authMessage');
    if (!el) return;
    el.innerText = msg;
    el.style.color = color;
    setTimeout(() => { if (el.innerText === msg) el.innerText = ''; }, 3000);
}

function showChangePwdMessage(msg, color = 'red') {
    const el = document.getElementById('changePwdMsg');
    if (!el) return;
    el.innerText = msg;
    el.style.color = color;
    setTimeout(() => { if (el.innerText === msg) el.innerText = ''; }, 5000);
}

// 登录处理
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
        // 手动注册：密码由用户输入，且必须符合规则
        if (!password) {
            showAuthMessage('请设置密码（至少6位，包含数字、大小写字母中的至少两种）');
            return;
        }
        if (!isPasswordComplex(password)) {
            showAuthMessage('密码至少6位，必须包含数字、大小写字母中的至少两种');
            return;
        }
        if (chosenRole === 'customer') {
            const user = await autoRegister(phone, 'customer', password);
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
            const user = await autoRegister(phone, chosenRole, password);
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

// 密码复杂度校验（前端）
function isPasswordComplex(pwd) {
    if (pwd.length < 6) return false;
    let hasDigit = /[0-9]/.test(pwd);
    let hasUpper = /[A-Z]/.test(pwd);
    let hasLower = /[a-z]/.test(pwd);
    let count = (hasDigit ? 1 : 0) + (hasUpper ? 1 : 0) + (hasLower ? 1 : 0);
    return count >= 2;
}

// 修改密码
async function handleChangePassword() {
    const newPwd = document.getElementById('newPasswordInput').value;
    const confirmPwd = document.getElementById('confirmPasswordInput').value;
    if (!newPwd || !confirmPwd) {
        showChangePwdMessage('请完整填写新密码和确认密码');
        return;
    }
    if (newPwd !== confirmPwd) {
        showChangePwdMessage('两次输入的密码不一致');
        return;
    }
    if (!isPasswordComplex(newPwd)) {
        showChangePwdMessage('密码至少6位，必须包含数字、大小写字母中的至少两种');
        return;
    }
    try {
        const res = await axios.post('/api/change-password', { newPassword: newPwd });
        if (res.data.success) {
            alert(`恭喜！密码修改成功！\n新密码：${newPwd}`);
            document.getElementById('newPasswordInput').value = '';
            document.getElementById('confirmPasswordInput').value = '';
            showChangePwdMessage('密码修改成功！', 'green');
            // 修改成功后自动返回概要页
            renderProfilePanel(false);
        }
    } catch (err) {
        showChangePwdMessage(err.response?.data?.error || '修改失败');
    }
}

// 退出登录
async function handleLogout() {
    await axios.post('/api/logout');
    currentUser = null;
    localStorage.removeItem('user');
    afterLogin();
    document.querySelector('#bottomNav .nav-item[data-tab="home"]')?.click();
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
            // 自动注册：密码为手机号后6位，后端不校验复杂度
            const user = await autoRegister(phone, 'customer');
            if (!user) return;
            currentUser = user;
            localStorage.setItem('user', JSON.stringify(currentUser));
            afterLogin();
            alert(`注册成功！默认登录密码为手机号后六位：${phone.slice(-6)}，建议及时修改`);
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
            alert(`注册成功！默认登录密码为手机号后六位：${phone.slice(-6)}，建议及时修改`);
            return;
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
        // 重置所有菜品数量为0
        document.querySelectorAll('.dish-item').forEach(item => {
            const minusBtn = item.querySelector('.dish-minus');
            const qtySpan = item.querySelector('.dish-qty-num');
            const plusBtn = item.querySelector('.dish-plus');
            if (qtySpan) qtySpan.textContent = '0';
            if (minusBtn) minusBtn.style.display = 'none';
            if (qtySpan) qtySpan.style.display = 'none';
            if (plusBtn) plusBtn.textContent = '+';
        });
        updateTotal();
        if (currentTab === 'orders') await loadCustomerOrders();
        alert('下单成功！');
    } catch (err) {
        alert('下单失败: ' + (err.response?.data?.error || err.message));
    }
}

// =====================================================
// 通用辅助函数
// =====================================================
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

// 自动注册：如果不传密码，后端使用手机号后6位（不校验复杂度）
async function autoRegister(phone, role, password = null) {
    try {
        const payload = { phone, role };
        if (password) {
            payload.password = password;
        }
        const res = await axios.post('/api/register', payload);
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
// 订单加载函数
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
            if (tab === 'dishes' && currentUser?.role === 'merchant') {
                renderMerchantDishes();
                // 重新绑定按钮事件（以防动态添加后丢失）
                bindMerchantEvents();
            }
            if (tab === 'profile') renderProfilePanel(false);
        });
    });
}

// 绑定商家面板的事件（保存所有、添加）
function bindMerchantEvents() {
    const addBtn = document.getElementById('addDishBtn');
    if (addBtn) {
        addBtn.removeEventListener('click', addNewDishRow);
        addBtn.addEventListener('click', addNewDishRow);
    }
    const saveBtn = document.getElementById('saveAllDishesBtn');
    if (saveBtn) {
        saveBtn.removeEventListener('click', saveAllDishes);
        saveBtn.addEventListener('click', saveAllDishes);
    }
}

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
        bindMerchantEvents();
    }
    renderProfilePanel(false);
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
        renderProfilePanel(false);
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