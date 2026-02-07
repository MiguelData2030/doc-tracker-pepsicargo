// --- CONFIGURACIÓN SUPABASE ---
// Si las keys están vacías, entrará en MODO DEMO automáticamente
const SUPABASE_URL = 'https://jfnbneovnwiuwjymhmoz.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_FUrIo6x2EZdcl7qfi2aBKA_PZlMXBF_';

let supabaseClient = null;
let currentUser = null;
let currentRole = null;
let isDemoMode = false;
let pendingChanges = {}; // Para el guardado por lotes en Admin

// --- MOCK USERS PARA VALIDACIÓN ---
const MOCK_USERS = [
    { email: 'admin@pepsico.com', pass: 'Pepsi2026*', rol: 'ADMIN', nombre: 'Admin Master', activo: true },
    { email: 'gerencia@pepsico.com', pass: 'Gerencia2026*', rol: 'GERENCIA', nombre: 'Director Operaciones', activo: true },
    { email: 'visor.parcial@pepsico.com', pass: 'Visor2026*', rol: 'VISOR_PARCIAL', nombre: 'Analista Jr', activo: true },
    { email: 'visor.total@pepsico.com', pass: 'VisorTotal2026*', rol: 'VISOR_TOTAL', nombre: 'Coordinador Regional', activo: true }
];

// --- MOCK DATA PARA DEMO ---
const MOCK_FLOTA = [
    {
        placa: 'KLR345', nit_cedula: '900123', categoria: 'PROPIA', sede_id: 'BOG', documentos: [
            { tipo: 'SOAT', vence: '2027-05-10' },
            { tipo: 'RTM', vence: '2026-02-05' }
        ]
    },
    {
        placa: 'PEP123', nit_cedula: '800555', categoria: 'PEPSICARGO', sede_id: 'MED', documentos: [
            { tipo: 'SOAT', vence: '2026-01-20' }, // VENCIDO
            { tipo: 'RTM', vence: '2026-06-15' }
        ]
    },
    {
        placa: 'GHT999', nit_cedula: '123456', categoria: 'PROPIA', sede_id: 'BOG', documentos: [
            { tipo: 'SOAT', vence: '2026-02-12' }, // ALERTA
            { tipo: 'RTM', vence: '2026-02-10' }  // ALERTA
        ]
    }
];

// --- INICIALIZACIÓN ---
document.addEventListener('DOMContentLoaded', async () => {
    initSupabase();

    // Auth Listeners
    setupAuthListeners();

    // Check Session
    const { data: { session } } = await supabaseClient.auth.getSession();
    if (session) {
        await handleSignIn(session.user);
    } else {
        showAuthScreen();
    }

    // Forms
    document.getElementById('login-form')?.addEventListener('submit', handleLoginSubmit);
    document.getElementById('admin-create-user')?.addEventListener('submit', handleAdminCreateUser);
    document.getElementById('onboarding-form')?.addEventListener('submit', handleOnboardingSubmit);
});

function setupAuthListeners() {
    supabaseClient.auth.onAuthStateChange(async (event, session) => {
        if (event === 'SIGNED_IN' && session) {
            await handleSignIn(session.user);
        } else if (event === 'SIGNED_OUT') {
            showAuthScreen();
        }
    });
}

async function handleSignIn(user) {
    currentUser = user;

    // Si el ID de usuario contiene 'mock', saltamos la verificación de Supabase DB
    if (user.id && user.id.startsWith('mock-')) {
        updateUIForRole();
        await loadInitialData();
        showAppScreen();
        return;
    }

    const { data: profile, error } = await supabaseClient
        .from('perfiles_usuario')
        .select('*')
        .eq('id', user.id)
        .single();

    if (error || !profile || !profile.activo) {
        console.error("Error de perfil o cuenta inactiva:", error);
        await handleLogout();
        return;
    }

    currentRole = profile.rol;
    updateUIForRole();
    await loadInitialData();
    showAppScreen();
}

function showAuthScreen() {
    document.getElementById('auth-container').style.display = 'flex';
    document.getElementById('app-container').style.display = 'none';
}

function showAppScreen() {
    document.getElementById('auth-container').style.display = 'none';
    document.getElementById('app-container').style.display = 'block';
}

async function handleLoginSubmit(e) {
    e.preventDefault();
    const rawEmail = document.getElementById('login-email').value;
    const pass = document.getElementById('login-pass').value;
    const errorMsg = document.getElementById('login-error');

    const email = rawEmail.toLowerCase().trim();
    errorMsg.style.display = 'none';

    console.log("Intento de login para:", email);

    // 1. Intentar con Usuarios de Prueba (Mock) para validación rápida
    const mockUser = MOCK_USERS.find(u => u.email.toLowerCase() === email && u.pass === pass);
    if (mockUser) {
        console.log("[MOCK] Credenciales correctas. Iniciando como:", mockUser.rol);
        await simulateMockLogin(mockUser);
        return;
    }

    console.warn("No se encontró usuario Mock, intentando Supabase real...");

    // 2. Si no es mock, intentar con Supabase Real Auth
    const { data, error } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
    if (error) {
        errorMsg.innerText = "Error: Credenciales inválidas o cuenta no registrada.";
        errorMsg.style.display = 'block';
    }
}

async function simulateMockLogin(user) {
    currentUser = { email: user.email, id: 'mock-uid-' + user.rol };
    currentRole = user.rol;
    isDemoMode = true;

    console.log("Simulando sesión para:", currentRole);

    updateUIForRole();
    await loadInitialData();
    showAppScreen();
    showSection('dashboard'); // Forzar visualización de la primera sección
}

async function handleLogout() {
    await supabaseClient.auth.signOut();
    currentUser = null;
    currentRole = null;
}

function initSupabase() {
    if (SUPABASE_URL === 'URL_PROYECTO') {
        isDemoMode = true;
        document.getElementById('demo-badge').style.display = 'flex';
        console.warn("Doc-Tracker: Iniciando en MODO DEMO. Configure Supabase para producción.");
    } else {
        supabaseClient = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
    }
}

function updateSystemStatus() {
    // Implementación básica o placeholder para evitar errores si se llama
    console.log("Estado del sistema actualizado.");
}

async function loadInitialData() {
    updateSystemStatus();
    await renderDashboard();
    await renderInventory();
}

// --- NAVEGACIÓN ---
function showSection(sectionId) {
    // Esconder todas
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');

    // Mostrar la elegida
    const target = document.getElementById(`section-${sectionId}`);
    if (target) target.style.display = 'block';

    // Ocultar botón Sincronizar RUNT en Admin
    const syncBtn = document.getElementById('btn-sync-runt');
    if (syncBtn) {
        syncBtn.style.display = sectionId === 'admin' ? 'none' : 'flex';
    }

    if (sectionId === 'admin') {
        pendingChanges = {}; // Reset cambios pendientes al entrar
        document.getElementById('btn-save-users').style.display = 'none';
        loadUsersList();
    }

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick')?.includes(`'${sectionId}'`)) {
            item.classList.add('active');
        }
    });
}

function toggleTechnicalFields() {
    const cat = document.getElementById('f_categoria').value;
    const techFields = document.getElementById('technical-fields');
    techFields.style.display = (cat === 'PROPIA' || cat === 'CORP') ? 'block' : 'none';
}

// --- LÓGICA DE NEGOCIO ---
async function renderDashboard() {
    const data = isDemoMode ? MOCK_FLOTA : await fetchRealData();
    let stats = { red: 0, yellow: 0, green: 0, total: data.length };
    const today = new Date();

    const vencimientosTbody = document.getElementById('vencimientos-body');
    vencimientosTbody.innerHTML = '';

    data.forEach(vh => {
        vh.documentos?.forEach(doc => {
            const vence = new Date(doc.vence);
            const diff = Math.ceil((vence - today) / (1000 * 60 * 60 * 24));

            let statusClass = 'status-valid';
            if (diff <= 0) { stats.red++; statusClass = 'status-expired'; }
            else if (diff <= 15) { stats.yellow++; statusClass = 'status-warning'; }
            else { stats.green++; }

            // Solo mostrar alertas y vencidos en el dashboard principal
            if (diff <= 30) {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td>${vh.placa}</td>
                    <td><span class="role-tag" style="background:var(--accent-blue)">${vh.categoria}</span></td>
                    <td>${doc.tipo}</td>
                    <td>${doc.vence}</td>
                    <td><span class="status-pill ${statusClass}">${diff <= 0 ? 'VENCIDO' : diff + ' días'}</span></td>
                `;
                vencimientosTbody.appendChild(tr);
            }
        });
    });

    document.getElementById('count-danger').innerText = stats.red;
    document.getElementById('count-warning').innerText = stats.yellow;
    document.getElementById('count-success').innerText = stats.green;
    document.getElementById('count-total').innerText = stats.total;
}

async function renderInventory() {
    const data = isDemoMode ? MOCK_FLOTA : await fetchRealData();
    const tbody = document.getElementById('fleet-table-body');
    tbody.innerHTML = '';

    data.forEach(vh => {
        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><strong>${vh.placa}</strong></td>
            <td>${vh.nit_cedula}</td>
            <td>${vh.categoria}</td>
            <td>${renderDocStatus(vh.documentos, 'SOAT')}</td>
            <td>${renderDocStatus(vh.documentos, 'RTM')}</td>
            <td>
                <button class="secondary" style="padding: 5px; min-width:auto;" title="Editar"><i data-lucide="edit-3" size="14"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

function renderDocStatus(docs, type) {
    const doc = docs.find(d => d.tipo === type);
    if (!doc) return '--';
    const vence = new Date(doc.vence);
    const today = new Date();
    const diff = Math.ceil((vence - today) / (1000 * 60 * 60 * 24));
    const status = diff <= 0 ? 'status-expired' : (diff <= 15 ? 'status-warning' : 'status-valid');
    return `<span class="status-pill ${status}">${doc.vence}</span>`;
}

// --- ACCIONES ---
function demoSync() {
    showToast("Sincronizando con RUNT Portal...");
    setTimeout(() => {
        showToast("Sincronización Exitosa: 32 documentos actualizados.");
        renderDashboard();
    }, 2000);
}

function showToast(msg, type = 'success') {
    const toast = document.getElementById('toast');
    toast.innerText = msg;
    toast.style.background = type === 'success' ? 'var(--success)' : 'var(--danger)';
    toast.style.display = 'block';
    setTimeout(() => { toast.style.display = 'none'; }, 3000);
}

// --- RUNT INTEGRATION ---
async function handleOnboardingSubmit(e) {
    e.preventDefault();
    const placa = document.getElementById('f_placa').value.toUpperCase();
    const nit = document.getElementById('f_nit').value;
    const categoria = document.getElementById('f_categoria').value;

    openRuntModal(placa);

    try {
        const data = await connectToRuntService(placa, nit, categoria);
        displaySyncResults(data);
    } catch (err) {
        showSyncError(err.message);
    }
}

function openRuntModal(placa) {
    document.getElementById('modal-runt-sync').style.display = 'flex';
    document.getElementById('sync-loading').style.display = 'block';
    document.getElementById('sync-results').style.display = 'none';
    const errorDiv = document.getElementById('sync-error');
    if (errorDiv) errorDiv.style.display = 'none';
}

function showSyncError(msg) {
    document.getElementById('sync-loading').style.display = 'none';
    let errorDiv = document.getElementById('sync-error');
    if (!errorDiv) {
        errorDiv = document.createElement('div');
        errorDiv.id = 'sync-error';
        errorDiv.style.textAlign = 'center';
        document.querySelector('#modal-runt-sync .modal-content').appendChild(errorDiv);
    }
    errorDiv.style.display = 'block';
    errorDiv.innerHTML = `
        <i data-lucide="wifi-off" size="48" style="color:var(--danger)"></i>
        <h2 style="margin-top:1rem; color:var(--danger)">Error de Conexión</h2>
        <p style="color:var(--text-muted); margin: 1rem 0;">${msg}</p>
        <button class="secondary" onclick="closeRuntModal()" style="width:100%">Reintentar más tarde</button>
    `;
    lucide.createIcons();
}

async function connectToRuntService(placa, nit, categoria) {
    try {
        const response = await fetch(`/sync?placa=${placa}&nit=${nit}&categoria=${categoria}`);
        if (!response.ok) {
            const errData = await response.json();
            throw new Error(errData.error || 'Error en el servidor de sincronización');
        }
        const data = await response.json();

        if (data.status === 'error') {
            throw new Error(data.message || 'Error en la extracción de datos');
        }

        return data;
    } catch (err) {
        console.error("Error de conexión:", err);
        throw new Error(err.message || "No se pudo conectar con el servidor local.");
    }
}

function formatDateRuntToIso(dateStr) {
    if (!dateStr || dateStr.includes('/') === false) return dateStr;
    const parts = dateStr.split('/');
    if (parts.length !== 3) return dateStr;
    return `${parts[2]}-${parts[1]}-${parts[0]}`;
}

function displaySyncResults(data) {
    document.getElementById('sync-loading').style.display = 'none';
    const resultsDiv = document.getElementById('sync-results');
    resultsDiv.style.display = 'block';

    window.currentRuntData = data;

    let technicalHtml = '';
    if (data.datos_tecnicos && Object.keys(data.datos_tecnicos).length > 0) {
        technicalHtml = `
            <div style="margin-top: 15px; padding-top: 15px; border-top: 1px dashed #444;">
                <h4 style="color: var(--accent-green); margin-bottom: 10px; font-size: 0.9rem;">ESPECIFICACIONES TÉCNICAS</h4>
                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.85rem;">
                    <div><span style="color:#888">VIN:</span> ${data.datos_tecnicos.vin || 'N/A'}</div>
                    <div><span style="color:#888">Motor:</span> ${data.datos_tecnicos.motor || 'N/A'}</div>
                    <div><span style="color:#888">Capacidad:</span> ${data.datos_tecnicos.capacidad || '0'} Kg</div>
                    <div><span style="color:#888">Ejes:</span> ${data.datos_tecnicos.ejes || '0'}</div>
                </div>
            </div>
        `;
    }

    resultsDiv.innerHTML = `
        <h3 style="color: var(--accent); margin-bottom: 15px;">Datos Oficiales Obtenidos</h3>
        <div class="sync-data-grid" style="display: grid; gap: 10px;">
            <!-- SOAT Section -->
            <div style="padding: 8px; background: rgba(0,255,150,0.05); border-radius: 4px; border-left: 3px solid var(--accent-green);">
                <div style="font-size: 0.75rem; color: #888; text-transform: uppercase;">Seguro Obligatorio (SOAT)</div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <span style="color: #aaa; font-size: 0.85rem;">Expedición:</span>
                    <span style="font-weight: bold;">${data.soat_expedicion || 'N/A'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #aaa; font-size: 0.85rem;">Vencimiento:</span>
                    <span style="font-weight: bold; color: var(--accent-green);">${data.soat || 'No encontrado'}</span>
                </div>
            </div>

            <!-- RTM Section -->
            <div style="padding: 8px; background: rgba(255,200,0,0.05); border-radius: 4px; border-left: 3px solid var(--warning);">
                <div style="font-size: 0.75rem; color: #888; text-transform: uppercase;">Revisión Técnico-Mecánica</div>
                <div style="display: flex; justify-content: space-between; margin-top: 5px;">
                    <span style="color: #aaa; font-size: 0.85rem;">Expedición:</span>
                    <span style="font-weight: bold;">${data.rtm_expedicion || 'N/A'}</span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span style="color: #aaa; font-size: 0.85rem;">Vencimiento:</span>
                    <span style="font-weight: bold; color: var(--warning);">
                        ${data.rtm || 'No registrado'}
                        ${data.rtm_proyectada ? '<span style="font-size:0.6rem; display:block;">(PROYECTADA +2 AÑOS)</span>' : ''}
                    </span>
                </div>
            </div>

            <!-- Vehículo -->
            <div style="display: flex; justify-content: space-between; border-top: 1px solid #333; padding: 10px 5px 0;">
                <span style="color: #aaa;">Marca/Modelo:</span>
                <span style="font-weight: bold;">${data.marca || '-'} / ${data.modelo || '-'}</span>
            </div>
        </div>
        ${technicalHtml}
        <div style="display: flex; gap: 10px; margin-top: 25px;">
            <button class="secondary" onclick="closeRuntModal()" style="flex: 1;">Reintentar</button>
            <button class="primary" onclick="confirmarRegistroRunt()" style="flex: 2;">Confirmar y Guardar</button>
        </div>
    `;
}

function confirmarRegistroRunt() {
    const placa = document.getElementById('f_placa').value.toUpperCase();
    const data = window.currentRuntData;
    const cat = document.getElementById('f_categoria').value;
    const sede = document.getElementById('f_sede').value;

    const newVehicle = {
        placa,
        nit_cedula: data.owner || '900123', // Fallback si no hay owner en data
        categoria: cat,
        sede_id: sede,
        marca: data.marca,
        modelo: data.modelo,
        vin: data.datos_tecnicos?.vin,
        motor: data.datos_tecnicos?.motor,
        documentos: [
            {
                tipo: 'SOAT',
                expedicion: data.soat_expedicion,
                vence: data.soat
            },
            {
                tipo: 'RTM',
                expedicion: data.rtm_expedicion,
                vence: data.rtm
            }
        ]
    };

    if (isDemoMode) {
        MOCK_FLOTA.push(newVehicle);
        renderDashboard();
        renderInventory();
        showToast(`Vehículo ${placa} registrado con éxito.`);
    }

    closeRuntModal();
    showSection('fleet');
}

async function fetchRealData() {
    if (isDemoMode) return MOCK_FLOTA;

    const { data, error } = await supabaseClient
        .from('vh_maestro')
        .select('*, documentos:vh_documentos(*)');

    if (error) {
        console.error("Error fetching vehicles:", error);
        return [];
    }
    return data;
}

function updateUIForRole() {
    const mail = document.getElementById('user-mail');
    const rol = document.getElementById('current-rol');

    mail.innerText = currentUser.email;
    rol.innerText = currentRole;

    // Admin visibility
    const adminItems = document.querySelectorAll('.admin-only');
    adminItems.forEach(el => el.style.display = (currentRole === 'ADMIN') ? 'flex' : 'none');

    // Action restrictions
    const restrictActions = (currentRole !== 'ADMIN');
    const onboardingNav = document.querySelector('.nav-item[onclick*="onboarding"]');
    if (onboardingNav) onboardingNav.style.display = restrictActions ? 'none' : 'flex';
}

// --- ADMIN FUNCTIONS ---
// --- ADMIN FUNCTIONS ---
async function loadUsersList() {
    if (currentRole !== 'ADMIN') return;

    const { data: dbUsers, error } = await supabaseClient
        .from('perfiles_usuario')
        .select('*');

    if (error) console.error("Error cargando usuarios de DB:", error);

    const tbody = document.getElementById('user-table-body');
    tbody.innerHTML = '';

    const allUsersMap = new Map();

    // 1. Mocks
    MOCK_USERS.forEach(mu => {
        const email = mu.email.toLowerCase().trim();
        allUsersMap.set(email, { ...mu, isMock: true });
    });

    // 2. Database
    if (dbUsers) {
        dbUsers.forEach(du => {
            const email = du.correo_corporativo.toLowerCase().trim();
            const existing = allUsersMap.get(email);
            allUsersMap.set(email, {
                ...du,
                pass: existing ? existing.pass : '********',
                isMock: false
            });
        });
    }

    allUsersMap.forEach((u, email) => {
        const tr = document.createElement('tr');
        const safeId = email.replace(/[@.]/g, '-');

        // Verificar si hay cambios pendientes para esta fila
        const pending = pendingChanges[email] || {};
        const activeStatus = pending.activo !== undefined ? pending.activo : u.activo;
        const activeRol = pending.rol !== undefined ? pending.rol : u.rol;

        if (!activeStatus) tr.classList.add('user-row-blocked');

        tr.innerHTML = `
            <td>${email}</td>
            <td>
                <select class="minimal-select" onchange="trackAdminChange('${email}', 'rol', this.value)" 
                        style="background: rgba(0, 168, 89, 0.1); color: var(--accent-green); border: none; padding: 4px 8px; border-radius: 6px; font-weight: 700; cursor: pointer; font-size: 0.75rem;">
                    <option value="ADMIN" ${u.rol === 'ADMIN' ? 'selected' : ''}>ADMIN</option>
                    <option value="GERENCIA" ${u.rol === 'GERENCIA' ? 'selected' : ''}>GERENCIA</option>
                    <option value="VISOR_PARCIAL" ${u.rol === 'VISOR_PARCIAL' ? 'selected' : ''}>VISOR_PARCIAL</option>
                    <option value="VISOR_TOTAL" ${u.rol === 'VISOR_TOTAL' ? 'selected' : ''}>VISOR_TOTAL</option>
                </select>
            </td>
            <td>
                <label class="switch">
                    <input type="checkbox" ${activeStatus ? 'checked' : ''} onchange="trackAdminChange('${email}', 'activo', this.checked)">
                    <span class="slider"></span>
                </label>
            </td>
            <td>
                <div style="display: flex; align-items: center; gap: 8px;">
                    <input type="password" value="${u.pass || '********'}" readonly 
                           style="background: transparent; border: none; padding: 0; width: 100px; color: var(--text-muted); font-size: 0.9rem;" 
                           id="pass-${safeId}">
                    <button class="secondary" style="padding: 4px;" onclick="togglePassView('${safeId}')">
                        <i data-lucide="eye" style="width: 14px; height: 14px;"></i>
                    </button>
                </div>
            </td>
            <td>
                <button class="secondary" style="padding:5px;" onclick="deleteUserPrompt('${email}')">
                    <i data-lucide="trash-2" style="color: var(--danger)"></i>
                </button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

function togglePassView(id) {
    const input = document.getElementById('pass-' + id);
    // Usar event.currentTarget asegura que agarremos el botón correcto
    const btnIcon = event.currentTarget.querySelector('i');
    if (input.type === 'password') {
        input.type = 'text';
        btnIcon.setAttribute('data-lucide', 'eye-off');
    } else {
        input.type = 'password';
        btnIcon.setAttribute('data-lucide', 'eye');
    }
    lucide.createIcons();
}

async function handleAdminCreateUser(e) {
    e.preventDefault();
    const email = document.getElementById('u_email').value.toLowerCase().trim();
    const password = document.getElementById('u_pass').value;
    const rol = document.getElementById('u_rol').value;

    showToast("Registrando nuevo acceso...", "info");

    // Agregar a mocks para acceso instantáneo
    MOCK_USERS.push({ email: email, pass: password, rol: rol, nombre: "Nuevo Usuario", activo: true });

    // Intento de persistencia en DB
    await supabaseClient.from('perfiles_usuario').upsert({
        id: 'mock-uid-' + Math.random().toString(36).substr(2, 9),
        correo_corporativo: email,
        rol: rol,
        activo: true
    });

    showToast("Usuario habilitado con éxito.");
    loadUsersList();
    e.target.reset();
}



function trackAdminChange(email, field, value) {
    if (!pendingChanges[email]) pendingChanges[email] = {};
    pendingChanges[email][field] = value;
    document.getElementById('btn-save-users').style.display = 'flex';
    if (field === 'activo') {
        const rows = document.querySelectorAll('#user-table-body tr');
        rows.forEach(row => {
            if (row.cells[0].innerText === email) {
                if (!value) row.classList.add('user-row-blocked');
                else row.classList.remove('user-row-blocked');
            }
        });
    }
}

async function commitAdminChanges() {
    showToast("Actualizando usuarios...", "info");
    for (const email in pendingChanges) {
        const changes = pendingChanges[email];
        const mIdx = MOCK_USERS.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
        if (mIdx !== -1) Object.assign(MOCK_USERS[mIdx], changes);
        await supabaseClient.from('perfiles_usuario').update(changes).eq('correo_corporativo', email);
    }
    pendingChanges = {};
    document.getElementById('btn-save-users').style.display = 'none';
    showToast("Configuración guardada correctamente.");
    loadUsersList();
}

async function deleteUserPrompt(email) {
    if (confirm(`¿Está seguro de eliminar el acceso para ${email}?`)) {
        showToast("Eliminando...", "info");
        const mIdx = MOCK_USERS.findIndex(u => u.email.toLowerCase() === email.toLowerCase());
        if (mIdx !== -1) MOCK_USERS.splice(mIdx, 1);
        await supabaseClient.from('perfiles_usuario').delete().eq('correo_corporativo', email);
        showToast("Usuario eliminado.");
        loadUsersList();
    }
}
