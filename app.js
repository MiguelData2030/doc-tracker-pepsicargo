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
        placa: 'KLR345', marca: 'CHEVROLET', modelo: 'NPR', propietario: 'JUAN PEREZ', nit_cedula: '900123', categoria: 'PROPIA', sede_id: 'BOG', estado: 'ACTIVO',
        soat_expedicion: '2026-05-11', soat_vencimiento: '2027-05-10',
        rtm_expedicion: '2025-02-06', rtm_vencimiento: '2026-02-05',
        documentos: []
    },
    {
        placa: 'PEP001', marca: 'FOTON', modelo: 'AUMARK', propietario: 'PEPSICO', nit_cedula: '800555', categoria: 'PEPSICARGO', sede_id: 'MED', estado: 'ACTIVO',
        soat_expedicion: '2023-12-01', soat_vencimiento: '2024-12-01', // VENCIDO
        rtm_expedicion: '2025-01-15', rtm_vencimiento: '2026-01-14',
        fumigacion_expedicion: '2025-02-01', fumigacion_vencimiento: '2025-08-01', fumigacion_archivo: 'https://example.com/fum.pdf',
        sanidad_expedicion: null, sanidad_vencimiento: null, sanidad_archivo: null
    },
    {
        placa: 'PEP002', marca: 'HINO', modelo: 'DUTRO', propietario: 'LOGISTICA S.A.', nit_cedula: '900222', categoria: 'PEPSICARGO', sede_id: 'CAL', estado: 'ACTIVO',
        soat_expedicion: '2024-06-01', soat_vencimiento: '2025-06-01',
        rtm_expedicion: '2024-06-05', rtm_vencimiento: '2025-06-04',
        fumigacion_expedicion: '2024-11-01', fumigacion_vencimiento: '2025-05-01', fumigacion_archivo: null,
        sanidad_expedicion: '2024-10-01', sanidad_vencimiento: '2025-04-01', sanidad_archivo: null
    },
    {
        placa: 'PEP003', marca: 'KENWORTH', modelo: 'T800', propietario: 'TRANSPORTES X', nit_cedula: '800111', categoria: 'PEPSICARGO', sede_id: 'BOG', estado: 'INACTIVO',
        soat_expedicion: '2023-01-01', soat_vencimiento: '2024-01-01',
        rtm_expedicion: '2023-01-01', rtm_vencimiento: '2024-01-01',
        fumigacion_expedicion: null, fumigacion_vencimiento: null,
        sanidad_expedicion: null, sanidad_vencimiento: null
    },
    {
        placa: 'PEP004', marca: 'ISUZU', modelo: 'NQR', propietario: 'PEPSICO', nit_cedula: '800555', categoria: 'PEPSICARGO', sede_id: 'BOG', estado: 'ACTIVO',
        soat_expedicion: '2025-01-10', soat_vencimiento: '2026-01-09',
        rtm_expedicion: '2025-01-12', rtm_vencimiento: '2026-01-11',
        fumigacion_expedicion: '2025-01-20', fumigacion_vencimiento: '2025-07-20', fumigacion_archivo: 'https://example.com/cert.pdf',
        sanidad_expedicion: '2025-01-22', sanidad_vencimiento: '2025-07-22', sanidad_archivo: 'https://example.com/san.pdf'
    },
    {
        placa: 'GHT999', nit_cedula: '123456', categoria: 'PROPIA', sede_id: 'BOG', estado: 'ACTIVO',
        soat_expedicion: '2025-02-12', soat_vencimiento: '2026-02-12',
        rtm_expedicion: '2025-02-10', rtm_vencimiento: '2026-02-10',
        documentos: []
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

    // Filter Listeners
    document.getElementById('fleet-search')?.addEventListener('input', applyFleetFilters);
    document.getElementById('filter-sede')?.addEventListener('change', applyFleetFilters);
    document.getElementById('filter-status')?.addEventListener('change', applyFleetFilters);
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
    // Si tenemos URL de Supabase configurada, USAR MODO REAL (Persistencia)
    if (SUPABASE_URL && SUPABASE_URL !== 'URL_PROYECTO') {
        isDemoMode = false;
        console.log("Modo Demo DESACTIVADO: Usando base de datos real.");
    } else {
        isDemoMode = true;
        console.warn("Modo Demo ACTIVADO: Los datos no se guardarán.");
    }

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
// Variables globales para gráficos
let sedeChart = null;
let statusChart = null;
let dashboardAlertsCache = [];

async function renderDashboard() {
    try {
        const rawData = isDemoMode ? MOCK_FLOTA : await fetchRealData();
        if (!rawData) return;

        // EXCLUIR INACTIVOS DEL CONTEO GLOBAL
        const data = rawData.filter(v => v.estado === 'ACTIVO');

        let stats = { red: 0, yellow: 0, green: 0, total: data.length };
        let catCounts = { 'PEPSICARGO': 0, 'PROPIA': 0, 'CORP': 0 };
        let sedeCounts = {};
        dashboardAlertsCache = [];

        const vencimientosTbody = document.getElementById('vencimientos-body');
        if (vencimientosTbody) vencimientosTbody.innerHTML = '';

        data.forEach(vh => {
            // Conteo por Categoría
            catCounts[vh.categoria] = (catCounts[vh.categoria] || 0) + 1;

            // Conteo por Sede
            const sedeName = vh.sede ? vh.sede.replace('_', ' ').toUpperCase() : 'S/D';
            sedeCounts[sedeName] = (sedeCounts[sedeName] || 0) + 1;

            const hasVencidos = { red: false, yellow: false };

            // Procesar Documentos
            if (vh.categoria === 'PEPSICARGO') {
                checkAndTrackStatus(vh.soat_vencimiento, 'SOAT', vh, stats, vencimientosTbody, hasVencidos);
                checkAndTrackStatus(vh.rtm_vencimiento, 'RTM', vh, stats, vencimientosTbody, hasVencidos);
                checkAndTrackStatus(vh.fumigacion_vencimiento, 'Fumigación', vh, stats, vencimientosTbody, hasVencidos);
                checkAndTrackStatus(vh.sanidad_vencimiento, 'Sanidad', vh, stats, vencimientosTbody, hasVencidos);
            } else {
                checkAndTrackStatus(vh.soat_vencimiento, 'SOAT', vh, stats, vencimientosTbody, hasVencidos);
                checkAndTrackStatus(vh.rtm_vencimiento, 'RTM', vh, stats, vencimientosTbody, hasVencidos);
            }

            if (!hasVencidos.red && !hasVencidos.yellow) stats.green++;
        });

        // Actualizar Contadores UI Principales
        if (document.getElementById('count-danger')) document.getElementById('count-danger').innerText = stats.red;
        if (document.getElementById('count-warning')) document.getElementById('count-warning').innerText = stats.yellow;
        if (document.getElementById('count-success')) document.getElementById('count-success').innerText = stats.green;
        if (document.getElementById('count-total')) document.getElementById('count-total').innerText = stats.total;

        // Actualizar Contadores por Categoría (Nuevos IDs)
        if (document.getElementById('count-pepsicargo')) document.getElementById('count-pepsicargo').innerText = catCounts.PEPSICARGO;
        if (document.getElementById('count-propia')) document.getElementById('count-propia').innerText = catCounts.PROPIA;
        if (document.getElementById('count-corp')) document.getElementById('count-corp').innerText = catCounts.CORP;

        // Renderizar Gráficos
        renderCharts(sedeCounts, stats);
        if (typeof lucide !== 'undefined') lucide.createIcons();

    } catch (err) {
        console.error("Error crítico en renderDashboard:", err);
    }
}



function checkAndTrackStatus(dateStr, type, vh, stats, tbody, flags) {
    if (!dateStr) return;
    const today = new Date();
    const vence = new Date(dateStr);
    const diff = Math.ceil((vence - today) / (1000 * 60 * 60 * 24));

    if (diff <= 0) {
        stats.red++;
        flags.red = true;
        const alertObj = { vh, type, date: dateStr, label: 'VENCIDO', color: 'var(--danger)', diff };
        dashboardAlertsCache.push(alertObj);
        addDashboardRow(alertObj, tbody);
    } else if (diff <= 30) {
        stats.yellow++;
        flags.yellow = true;
        const alertObj = { vh, type, date: dateStr, label: 'POR VENCER', color: 'var(--warning)', diff };
        dashboardAlertsCache.push(alertObj);
        addDashboardRow(alertObj, tbody);
    }
}

function addDashboardRow(alert, tbody) {
    if (!tbody) return;
    const { vh, type, date, color, diff } = alert;

    const tr = document.createElement('tr');
    tr.style.background = 'rgba(255,255,255,0.03)';
    tr.style.marginBottom = '8px';

    tr.innerHTML = `
        <td style="border-radius: 8px 0 0 8px; padding: 12px;">
            <div style="font-weight:700; color:var(--accent-green);">${vh.placa}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${vh.marca || 'N/A'}</div>
        </td>
        <td><span class="role-tag" style="background:rgba(0,168,89,0.1); color:var(--accent-green); border:1px solid rgba(0,168,89,0.2);">${vh.categoria}</span></td>
        <td style="font-size:0.8rem; font-weight:600; color:var(--warning); text-transform:uppercase;">${vh.sede ? vh.sede.replace('_', ' ') : '--'}</td>
        <td style="font-weight:600;">${type}</td>
        <td style="font-family: monospace; font-size:0.9rem;">${date}</td>
        <td style="border-radius: 0 8px 8px 0; text-align: center;">
            <span class="status-pill" style="background:${color}; color:#000; font-weight:800; min-width:80px; text-transform:uppercase;">
                ${diff <= 0 ? 'VENCIDO' : diff + ' DÍAS'}
            </span>
        </td>
    `;
    tbody.appendChild(tr);
}

function filterDashboardAlerts() {
    const placaQ = document.getElementById('dash-filter-placa').value.toUpperCase();
    const sedeQ = document.getElementById('dash-filter-sede').value;
    const docQ = document.getElementById('dash-filter-doc').value.toUpperCase();

    const tbody = document.getElementById('vencimientos-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    const filtered = dashboardAlertsCache.filter(item => {
        const matchesPlaca = item.vh.placa.includes(placaQ);
        const matchesSede = !sedeQ || (item.vh.sede === sedeQ);
        const matchesDoc = !docQ || (item.type.toUpperCase() === docQ);
        return matchesPlaca && matchesSede && matchesDoc;
    });

    filtered.forEach(alert => addDashboardRow(alert, tbody));
}

function exportDashboardAlertsToCSV() {
    if (dashboardAlertsCache.length === 0) {
        showToast("No hay alertas para exportar.", "info");
        return;
    }

    // Usar datos filtrados actualmente si los filtros están activos
    const placaQ = document.getElementById('dash-filter-placa').value.toUpperCase();
    const sedeQ = document.getElementById('dash-filter-sede').value;
    const docQ = document.getElementById('dash-filter-doc').value.toUpperCase();

    const dataToExport = dashboardAlertsCache.filter(item => {
        const matchesPlaca = item.vh.placa.includes(placaQ);
        const matchesSede = !sedeQ || (item.vh.sede === sedeQ);
        const matchesDoc = !docQ || (item.type.toUpperCase() === docQ);
        return matchesPlaca && matchesSede && matchesDoc;
    });

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "PLACA,MARCA,CATEGORIA,SEDE,DOCUMENTO,VENCIMIENTO,DIAS_RESTANTES\n";

    dataToExport.forEach(item => {
        const row = [
            item.vh.placa,
            item.vh.marca || '',
            item.vh.categoria,
            item.vh.sede || '',
            item.type,
            item.date,
            item.diff
        ].join(",");
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `alertas_flota_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    showToast("Reporte exportado con éxito.");
}

function renderCharts(sedeCounts, stats) {
    try {
        if (typeof Chart === 'undefined') {
            console.warn("Chart.js no está cargado.");
            return;
        }

        // 1. Gráfico de Sedes (Horizontal Bar)
        const canvasSede = document.getElementById('chart-sedes');
        if (canvasSede) {
            const ctxSede = canvasSede.getContext('2d');
            if (sedeChart) sedeChart.destroy();

            const sedeLabels = Object.keys(sedeCounts);
            const sedeData = Object.values(sedeCounts);

            sedeChart = new Chart(ctxSede, {
                type: 'bar',
                data: {
                    labels: sedeLabels,
                    datasets: [{
                        label: 'Vehículos',
                        data: sedeData,
                        backgroundColor: 'rgba(0, 168, 89, 0.6)',
                        borderColor: 'var(--accent-green)',
                        borderWidth: 1,
                        borderRadius: 4
                    }]
                },
                options: {
                    indexAxis: 'y',
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: { legend: { display: false } },
                    scales: {
                        x: { grid: { color: '#262626' }, ticks: { color: '#888' } },
                        y: { grid: { display: false }, ticks: { color: '#fff', font: { weight: 'bold' } } }
                    }
                }
            });
        }

        // 2. Gráfico de Estados (Doughnut)
        const canvasStat = document.getElementById('chart-status');
        if (canvasStat) {
            const ctxStat = canvasStat.getContext('2d');
            if (statusChart) statusChart.destroy();
            statusChart = new Chart(ctxStat, {
                type: 'doughnut',
                data: {
                    labels: ['Críticos', 'En Alerta', 'En Regla'],
                    datasets: [{
                        data: [stats.red, stats.yellow, stats.green],
                        backgroundColor: ['#FF3B30', '#FFCC00', '#34C759'],
                        borderWidth: 0,
                        hoverOffset: 15
                    }]
                },
                options: {
                    responsive: true,
                    maintainAspectRatio: false,
                    plugins: {
                        legend: {
                            position: 'bottom',
                            labels: { color: '#fff', font: { size: 10, weight: '600' }, padding: 20 }
                        }
                    },
                    cutout: '70%'
                }
            });
        }
    } catch (err) {
        console.error("Error en renderCharts:", err);
    }
}


async function renderInventory(data = null) {
    if (!data) data = isDemoMode ? MOCK_FLOTA : await fetchRealData();
    const tbody = document.getElementById('fleet-table-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    if (data.length === 0) {
        tbody.innerHTML = '<tr><td colspan="6" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay vehículos registrados en esta categoría.</td></tr>';
        return;
    }

    // VISTA PEPSICARGO (DETALLADA)
    if (window.currentFleetCategory === 'PEPSICARGO') {
        renderPepsiCargoTable(tbody, data);
        lucide.createIcons();
        return;
    }

    // RESET HEADERS FOR STANDARD VIEW (PROPIA / CORP)
    const thead = tbody.closest('table').querySelector('thead tr');
    if (thead) {
        thead.innerHTML = `
            <th>PLACA</th>
            <th>PROPIETARIO</th>
            <th>CATEGORÍA</th>
            <th style="color:var(--warning);">SEDE</th>
            <th style="color:var(--accent-blue);">SOAT</th>
            <th style="color:var(--accent-purple);">RTM</th>
            <th style="width:100px; text-align:center;">ACCIONES</th>
        `;
    }

    // VISTA STANDARD (PROPIA / CORP)
    data.forEach(vh => {
        const tr = document.createElement('tr');
        const isActive = vh.estado === 'ACTIVO';
        if (!isActive) { tr.style.opacity = '0.5'; tr.style.filter = 'grayscale(100%)'; }

        tr.innerHTML = `
            <td><strong>${vh.placa}</strong></td>
            <td>${vh.propietario || vh.nit_cedula || '--'}</td>
            <td><span class="role-tag" style="background:var(--accent-blue)">${vh.categoria || 'N/A'}</span></td>
            <td style="color:var(--warning); font-weight:600;">${vh.sede ? vh.sede.replace('_', ' ') : '--'}</td>
            <td>${renderDocStatus(vh, 'SOAT')}</td>
            <td>${renderDocStatus(vh, 'RTM')}</td>
            <td style="text-align:center;">
                <button class="secondary" style="padding: 5px; min-width:auto;" title="Editar"><i data-lucide="edit-3" size="14"></i></button>
            </td>
        `;
        tbody.appendChild(tr);
    });
    lucide.createIcons();
}

// --- RENDER PEPSICARGO ---
function renderPepsiCargoTable(tbody, data) {
    const table = tbody.closest('table');
    const thead = table ? table.querySelector('thead tr') : null;

    if (thead && window.currentFleetCategory === 'PEPSICARGO') {
        thead.innerHTML = `
            <th style="min-width:140px; border-right:2px solid var(--border-color);">Placa / Info</th>
            <th style="min-width:100px;">Propietario / NIT</th>
            <th style="min-width:100px;">Categoría</th>
            <th style="min-width:100px; color:var(--warning);">Sede Operativa</th>
            
            <!-- SOAT -->
            <th style="color:var(--accent-blue);">SOAT Exp.</th>
            <th style="color:var(--accent-blue);">SOAT Fin Vig.</th>
            <th style="color:var(--accent-blue); border-right:1px solid var(--border-color);">Vig. Días</th>
            
            <!-- RTM -->
            <th style="color:var(--accent-purple);">RTM Exp.</th>
            <th style="color:var(--accent-purple);">RTM Fin Vig.</th>
            <th style="color:var(--accent-purple); border-right:1px solid var(--border-color);">Vig. Días</th>
            
            <!-- Fumigación -->
            <th style="color:var(--accent-green); text-align:center;">Opción</th>
            <th style="color:var(--accent-green);">Fum. Exp.</th>
            <th style="color:var(--accent-green);">Fum. Fin Vig.</th>
            <th style="color:var(--accent-green); border-right:1px solid var(--border-color);">Vig. Días</th>
            
            <!-- Sanidad -->
            <th style="color:orange; text-align:center;">Opción</th>
            <th style="color:orange);">San. Exp.</th>
            <th style="color:orange);">San. Fin Vig.</th>
            <th style="color:orange; border-right:1px solid var(--border-color);">Vig. Días</th>
            
            <th style="min-width:110px; text-align:center;">Acciones</th>
        `;
    }

    data.forEach(vh => {
        const tr = document.createElement('tr');
        const isActive = vh.estado === 'ACTIVO';

        if (!isActive) {
            tr.style.opacity = '0.5';
            tr.style.filter = 'grayscale(100%)';
            tr.style.background = 'rgba(0,0,0,0.1)';
        }

        const soat = getDaysRemaining(vh.soat_vencimiento);
        const rtm = getDaysRemaining(vh.rtm_vencimiento);
        const fum = getDaysRemaining(vh.fumigacion_vencimiento);
        const san = getDaysRemaining(vh.sanidad_vencimiento);

        tr.innerHTML = `
            <td style="border-right:2px solid var(--border-color);">
                <div style="font-weight:bold; font-size:1.1rem; color:var(--accent-green);">${vh.placa}</div>
                <div style="font-size:0.75rem; color:white;">${vh.marca || 'GENÉRICO'}</div>
            </td>
            <td><div style="font-size:0.85rem;">${vh.nit_cedula || vh.propietario || '--'}</div></td>
            <td><div style="font-size:0.85rem;">${vh.categoria || '--'}</div></td>
            <td><div style="font-size:0.85rem; color:var(--warning); font-weight:600;">${vh.sede ? vh.sede.replace('_', ' ') : '--'}</div></td>
            
            <!-- SOAT -->
            <td style="font-size:0.8rem; color:var(--text-muted)">${vh.soat_expedicion || '--'}</td>
            <td style="font-weight:bold; font-size:0.85rem">${vh.soat_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${soat.color}; color:#000; font-weight:800; font-size:0.75rem">${soat.text}</span></td>
            
            <!-- RTM -->
            <td style="font-size:0.8rem; color:var(--text-muted)">${vh.rtm_expedicion || '--'}</td>
            <td style="font-weight:bold; font-size:0.85rem">${vh.rtm_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${rtm.color}; color:#000; font-weight:800; font-size:0.75rem">${rtm.text}</span></td>
            
            <!-- Fumigación -->
            <td style="text-align:center;">
                 <div style="display:flex; gap:4px; justify-content:center">
                    <button class="secondary" style="padding:4px; border-radius:4px;" onclick="promptUpload('${vh.placa}', 'fumigacion')" title="Cargar/Editar"><i data-lucide="upload-cloud" style="width:14px"></i></button>
                    ${vh.fumigacion_archivo ? `<button class="secondary" style="padding:4px; border-radius:4px; background:rgba(0,168,89,0.2)" onclick="window.open('${vh.fumigacion_archivo}', '_blank')" title="Ver Archivo"><i data-lucide="folder-open" style="width:14px; color:var(--accent-green)"></i></button>` : ''}
                 </div>
            </td>
            <td style="font-size:0.8rem; color:var(--text-muted)">
                ${vh.fumigacion_expedicion || '--'}
                <button class="secondary" style="padding:2px; margin-left:4px; border:none; background:transparent;" onclick="promptUpload('${vh.placa}', 'fumigacion')" title="Editar Fechas"><i data-lucide="pencil" style="width:10px; color:var(--accent-green)"></i></button>
            </td>
            <td style="font-weight:bold; font-size:0.85rem">${vh.fumigacion_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${fum.color}; color:#000; font-weight:800; font-size:0.75rem">${fum.text}</span></td>

            <!-- Sanidad -->
            <td style="text-align:center;">
                 <div style="display:flex; gap:4px; justify-content:center">
                    <button class="secondary" style="padding:4px; border-radius:4px;" onclick="promptUpload('${vh.placa}', 'sanidad')" title="Cargar/Editar"><i data-lucide="upload-cloud" style="width:14px"></i></button>
                    ${vh.sanidad_archivo ? `<button class="secondary" style="padding:4px; border-radius:4px; background:rgba(0,168,89,0.2)" onclick="window.open('${vh.sanidad_archivo}', '_blank')" title="Ver Archivo"><i data-lucide="folder-open" style="width:14px; color:var(--accent-green)"></i></button>` : ''}
                 </div>
            </td>
            <td style="font-size:0.8rem; color:var(--text-muted)">
                ${vh.sanidad_expedicion || '--'}
                <button class="secondary" style="padding:2px; margin-left:4px; border:none; background:transparent;" onclick="promptUpload('${vh.placa}', 'sanidad')" title="Editar Fechas"><i data-lucide="pencil" style="width:10px; color:orange;"></i></button>
            </td>
            <td style="font-weight:bold; font-size:0.85rem">${vh.sanidad_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${san.color}; color:#000; font-weight:800; font-size:0.75rem">${san.text}</span></td>
            
            <!-- Acciones -->
            <td>
               <div style="display:flex; gap:8px; align-items:center; justify-content:center;">
                    <label class="switch" title="${isActive ? 'Desactivar' : 'Activar'}" style="margin:0;">
                        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleVehicleStatus('${vh.placa}', this.checked, '${window.currentFleetCategory}')">
                        <span class="slider"></span>
                    </label>
               </div>
            </td>
        `;
        tbody.appendChild(tr);
    });
}

async function toggleVehicleStatus(placa, isActive, category) {
    const newState = isActive ? 'ACTIVO' : 'INACTIVO';
    let tableName = 'gestion_vehiculos_pepsicargo';
    if (category === 'PROPIA') tableName = 'gestion_vehiculos_flota_propia';
    if (category === 'CORP') tableName = 'gestion_vehiculos_corporativos';

    // Update Mock
    if (isDemoMode) {
        const v = MOCK_FLOTA.find(x => x.placa === placa);
        if (v) v.estado = newState;
        showToast(`Vehículo ${placa} ${newState === 'ACTIVO' ? 'Activado' : 'Inactivado'} (Demo)`);
        loadFleetData();
        return;
    }

    try {
        const { error } = await supabaseClient
            .from(tableName)
            .update({ estado: newState })
            .eq('placa', placa);

        if (error) throw error;

        // Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'CAMBIO_ESTADO_VEHICULO',
            details: { placa, nuevo_estado: newState, categoria: category, usuario: currentUser?.email },
            user_email: currentUser?.email
        });

        showToast(`Estado ${placa}: ${newState}`);
        loadFleetData();
    } catch (err) {
        console.error(err);
        showToast("Error actualizando estado", "error");
    }
}

function getDaysRemaining(dateStr) {
    if (!dateStr) return { days: '--', color: 'rgba(255,255,255,0.1)', text: '--' };
    const today = new Date();
    const d = new Date(dateStr);
    const diff = Math.ceil((d - today) / (1000 * 60 * 60 * 24));

    let color = 'var(--success)';
    if (diff <= 0) color = 'var(--danger)';
    else if (diff <= 30) color = 'var(--warning)';

    return { days: diff, color: color, text: `${diff} días` };
}

function renderDocStatus(vh, type) {
    let vence = null;

    // Soporte para estructura plana (SQL) vs anidada (MOCK)
    if (vh.documentos && Array.isArray(vh.documentos)) {
        const doc = vh.documentos.find(d => d.tipo === type);
        if (doc) vence = doc.vence;
    } else {
        if (type === 'SOAT') vence = vh.soat_vencimiento;
        if (type === 'RTM') vence = vh.rtm_vencimiento;
    }

    if (!vence) return '<span class="status-pill" style="background:var(--card-bg); color:var(--text-muted); border: 1px solid var(--border-color);">--</span>';

    const vDate = new Date(vence);
    const today = new Date();
    const diff = Math.ceil((vDate - today) / (1000 * 60 * 60 * 24));

    let status = 'status-valid';
    if (diff <= 0) status = 'status-expired';
    else if (diff <= 30) status = 'status-warning';

    return `<span class="status-pill ${status}">${vence}</span>`;
}

// Nueva función de carga de flota segregada
window.allFleetData = []; // Cache para filtrado

async function loadFleetData() {
    const cat = window.currentFleetCategory || 'PEPSICARGO';
    let tableName = 'gestion_vehiculos_pepsicargo';
    let title = 'Flota PepsiCargo';

    if (cat === 'PROPIA') { tableName = 'gestion_vehiculos_flota_propia'; title = 'Flota Propia'; }
    if (cat === 'CORP') { tableName = 'gestion_vehiculos_corporativos'; title = 'Vehículos Corporativos'; }

    // Actualizar título
    const headerEl = document.querySelector('#section-fleet h2');
    if (headerEl) headerEl.innerText = title;

    if (isDemoMode) {
        window.allFleetData = MOCK_FLOTA
            .filter(v => v.categoria === cat)
            .sort((a, b) => {
                // 1. Estado (ACTIVO < INACTIVO)
                if (a.estado !== b.estado) return a.estado === 'ACTIVO' ? -1 : 1;
                // 2. Placa (Alfabético)
                return a.placa.localeCompare(b.placa);
            });
        applyFleetFilters();
        return;
    }

    // Cargar de Supabase
    showToast("Cargando inventario...", "info");
    const { data, error } = await supabaseClient
        .from(tableName)
        .select('*')
        .order('estado', { ascending: true }) // ACTIVO < INACTIVO
        .order('placa', { ascending: true });

    if (error) {
        console.error("Error loading fleet:", error);
        showToast("Error cargando datos: " + error.message, "error");
        return;
    }

    window.allFleetData = data;
    applyFleetFilters();
}

function applyFleetFilters() {
    const query = document.getElementById('fleet-search').value.toUpperCase();
    const sedeFilter = document.getElementById('filter-sede').value;
    const statusFilter = document.getElementById('filter-status').value;

    const filtered = window.allFleetData.filter(vh => {
        // 1. Filtro por Placa
        const matchesPlate = vh.placa.includes(query);

        // 2. Filtro por Sede
        const normalizedSede = vh.sede ? vh.sede.replace('_', ' ').toUpperCase() : '';
        const matchesSede = sedeFilter === 'ALL' || normalizedSede.includes(sedeFilter.toUpperCase());

        // 3. Filtro por Estado (Rojo/Amarillo/Verde)
        let matchesStatus = true;
        if (statusFilter !== 'ALL') {
            const soat = getDaysRemaining(vh.soat_vencimiento);
            const rtm = getDaysRemaining(vh.rtm_vencimiento);
            const fum = getDaysRemaining(vh.fumigacion_vencimiento);
            const san = getDaysRemaining(vh.sanidad_vencimiento);

            const colors = [soat.color, rtm.color, fum.color, san.color];

            if (statusFilter === 'RED') matchesStatus = colors.includes('var(--danger)');
            if (statusFilter === 'YELLOW') matchesStatus = colors.includes('var(--warning)');
            if (statusFilter === 'GREEN') matchesStatus = !colors.includes('var(--danger)') && !colors.includes('var(--warning)');
        }

        return matchesPlate && matchesSede && matchesStatus;
    });

    renderInventory(filtered);
    lucide.createIcons();
}

function resetFilters() {
    document.getElementById('fleet-search').value = '';
    document.getElementById('filter-sede').value = 'ALL';
    document.getElementById('filter-status').value = 'ALL';
    applyFleetFilters();
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
// --- RUNT INTEGRATION ---
async function handleOnboardingSubmit(e) {
    e.preventDefault();
    const placa = document.getElementById('f_placa').value.toUpperCase();
    const nit = document.getElementById('f_nit').value;
    const categoria = document.getElementById('f_categoria').value;

    // 0. Validar Duplicados
    showToast(`Verificando existencia de ${placa}...`, "info");
    const duplicationCheck = await checkVehicleExists(placa);
    if (duplicationCheck.exists) {
        showToast(`El vehículo ${placa} ya está registrado en ${duplicationCheck.categoria}.`, "warning");
        // Opcional: Podríamos redirigir al usuario al vehículo existente
        return;
    }

    openRuntLoading(placa);

    try {
        const data = await connectToRuntService(placa, nit, categoria);
        displaySyncResults(data);
    } catch (err) {
        showSyncError(err.message);
    }
}

async function checkVehicleExists(placa) {
    if (isDemoMode) {
        const found = MOCK_FLOTA.find(v => v.placa === placa);
        return found ? { exists: true, categoria: found.categoria } : { exists: false };
    }

    // Consultar paralelamente las 3 tablas
    const p1 = supabaseClient.from('gestion_vehiculos_pepsicargo').select('categoria').eq('placa', placa).single();
    const p2 = supabaseClient.from('gestion_vehiculos_flota_propia').select('categoria').eq('placa', placa).single();
    const p3 = supabaseClient.from('gestion_vehiculos_corporativos').select('categoria').eq('placa', placa).single();

    const [r1, r2, r3] = await Promise.all([p1, p2, p3]);

    if (r1.data) return { exists: true, categoria: 'PEPSICARGO' };
    if (r2.data) return { exists: true, categoria: 'FLOTA PROPIA' };
    if (r3.data) return { exists: true, categoria: 'CORPORATIVOS' };

    return { exists: false };
}

function openRuntLoading(placa) {
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    emptyDiv.innerHTML = `
        <div class="spinner"></div>
        <p style="margin-top:1.5rem; font-weight: 600;">Consultando RUNT para <span style="color:var(--accent-green)">${placa}</span></p>
        <p style="color:var(--text-muted); font-size: 0.8rem; margin-top: 5px;">Resolviendo código de seguridad (esto puede tomar varios intentos)...</p>
    `;
    resultsDiv.style.display = 'none';
}

function displaySyncResults(data) {
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    // Almacenar globalmente para el guardado
    window.currentRuntData = data;

    emptyDiv.innerHTML = '';
    resultsDiv.style.display = 'block';

    resultsDiv.innerHTML = `
        <div class="result-card" style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px; margin-bottom: 1rem;">
            <h4 style="margin-bottom: 0.5rem; color: var(--accent-blue); display: flex; align-items: center; gap: 8px;">
                <i data-lucide="car"></i> Información del Vehículo
            </h4>
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; font-size: 0.9rem;">
                <div><span>Placa:</span> <strong>${data.placa}</strong></div>
                <div><span>Marca:</span> <strong>${data.marca}</strong></div>
                <div><span>Modelo:</span> <strong>${data.modelo}</strong></div>
                <div><span>Propietario:</span> <strong>${data.owner || 'No disponible'}</strong></div>
            </div>
        </div>

        <div class="result-card" style="background: rgba(255,255,255,0.05); padding: 1rem; border-radius: 8px;">
            <h4 style="margin-bottom: 0.5rem; color: var(--accent-green); display: flex; align-items: center; gap: 8px;">
                <i data-lucide="file-check"></i> Documentación
            </h4>
            <div style="display: flex; flex-direction: column; gap: 8px; font-size: 0.9rem;">
                <div style="display: flex; justify-content: space-between;">
                    <span>SOAT Vence:</span> 
                    <span style="font-weight: bold; color: ${data.soat === 'No encontrado' ? 'var(--danger)' : 'var(--success)'}">
                        ${data.soat}
                    </span>
                </div>
                <div style="display: flex; justify-content: space-between;">
                    <span>RTM Vence:</span> 
                    <span style="font-weight: bold; color: ${(data.rtm === 'No registrado' || String(data.rtm).includes('Estimado')) ? 'var(--warning)' : 'var(--success)'}">
                        ${data.rtm}
                    </span>
                </div>
            </div>
        </div>

        <div style="margin-top: 1.5rem; text-align: center;">
            <button class="primary" style="width: 100%; justify-content: center;" onclick="confirmarRegistroRunt()">
                <i data-lucide="save"></i> Confirmar y Guardar
            </button>
        </div>
    `;
    lucide.createIcons();
}

function showSyncError(msg) {
    const emptyDiv = document.querySelector('.empty-results');

    // Simplificar mensajes técnicos de Playwright
    let cleanMsg = msg;
    if (msg.includes("Timeout")) cleanMsg = "El portal RUNT está tardando demasiado en responder. Inténtalo de nuevo en unos minutos.";
    if (msg.includes("captcha")) cleanMsg = "No se pudo validar el código de seguridad (Captcha). Reintenta la búsqueda.";
    if (msg.includes("frame-ancestors")) cleanMsg = "Error de seguridad en el portal oficial. Intenta más tarde.";

    emptyDiv.innerHTML = `
        <i data-lucide="alert-circle" size="48" style="color:var(--danger)"></i>
        <h2 style="margin-top:1rem; color:var(--danger); font-size: 1.2rem;">Atención</h2>
        <p style="color:var(--text-muted); font-size: 0.9rem; max-width: 320px; margin: 15px auto; line-height: 1.4;">${cleanMsg}</p>
        <div style="display:flex; gap:10px; justify-content:center; margin-top: 1rem;">
             <button class="secondary" onclick="showSection('onboarding')" style="font-size: 0.85rem; padding: 8px 20px;">Reintentar</button>
        </div>
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
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    emptyDiv.style.display = 'none';
    resultsDiv.style.display = 'block';

    window.currentRuntData = data;

    resultsDiv.innerHTML = `
        <div class="data-frame-content">
            <h3 style="color: var(--accent-green); margin-bottom: 1.5rem; display: flex; align-items: center; gap: 8px;">
                <i data-lucide="check-circle"></i> Datos Oficiales (RUNT)
            </h3>
            
            <div class="sync-item">
                <label>Sede Operativa</label>
                <span style="color:var(--warning)">${document.getElementById('f_sede').value.replace('_', ' ')}</span>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="sync-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <label>SOAT Exp.</label>
                    <span style="color:var(--accent-blue)">${data.soat_expedicion || '--'}</span>
                </div>
                <div class="sync-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <label>SOAT Venc.</label>
                    <span>${data.soat || 'NO ENCONTRADO'}</span>
                </div>
            </div>

            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px;">
                <div class="sync-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <label>RTM Exp.</label>
                    <span style="color:var(--accent-purple)">${data.rtm_expedicion || '--'}</span>
                </div>
                <div class="sync-item" style="flex-direction: column; align-items: flex-start; gap: 4px;">
                    <label>RTM Venc.</label>
                    <span>${data.rtm || 'NO REGISTRADO'}</span>
                </div>
            </div>

            <div class="sync-item">
                <label>Marca / Modelo</label>
                <span style="color:white">${data.marca || '-'} / ${data.modelo || '-'}</span>
            </div>

            <div class="sync-item">
                <label>Propietario Sugerido</label>
                <span style="color:white; font-size: 0.8rem;">${data.owner || 'Información Privada'}</span>
            </div>

            <div style="margin-top: 2rem; display: flex; gap: 1rem;">
                <button class="primary" onclick="confirmarRegistroRunt()" style="flex: 1; justify-content: center; background: var(--accent-green); color: black;">
                    Guardar Registro
                </button>
            </div>
        </div>
    `;
    lucide.createIcons();
}

async function confirmarRegistroRunt() {
    const placa = document.getElementById('f_placa').value.toUpperCase();
    const data = window.currentRuntData;
    const cat = document.getElementById('f_categoria').value;
    const sede = document.getElementById('f_sede').value;
    const nitInput = document.getElementById('f_nit').value;

    // Determinar tabla destino
    let tableName = '';
    if (cat === 'PEPSICARGO') tableName = 'gestion_vehiculos_pepsicargo';
    else if (cat === 'PROPIA') tableName = 'gestion_vehiculos_flota_propia';
    else if (cat === 'CORP') tableName = 'gestion_vehiculos_corporativos';

    // Limpieza de Fechas (RVA Estimado -> YYYY-MM-DD)
    let finalRtm = data.rtm;
    if (finalRtm && finalRtm.includes('Estimado')) {
        finalRtm = finalRtm.split(' ')[0]; // Extraer solo la fecha
    }
    if (finalRtm === 'No registrado' || finalRtm === 'No encontrado') finalRtm = null;

    let finalSoat = data.soat;
    if (finalSoat === 'No encontrado' || finalSoat === 'No registrado') finalSoat = null;

    const newVehicle = {
        placa: placa,
        categoria: cat,
        propietario: nitInput || data.owner || 'S/D',
        sede: sede,
        marca: data.marca,
        modelo: data.modelo,
        vin: data.datos_tecnicos?.vin || null,
        motor: data.datos_tecnicos?.motor || null,
        cilindraje: data.datos_tecnicos?.cilindraje || null,
        capacidad: data.datos_tecnicos?.capacidad || null,
        soat_vencimiento: formatDateRuntToIso(finalSoat),
        rtm_vencimiento: formatDateRuntToIso(finalRtm),
        soat_expedicion: formatDateRuntToIso(data.soat_expedicion) || null,
        rtm_expedicion: formatDateRuntToIso(data.rtm_expedicion) || null,
        fumigacion_expedicion: null,
        fumigacion_vencimiento: null,
        fumigacion_archivo: null,
        sanidad_expedicion: null,
        sanidad_vencimiento: null,
        sanidad_archivo: null,
        estado: 'ACTIVO'
    };

    if (isDemoMode) {
        MOCK_FLOTA.push(newVehicle);
        showToast(`[DEMO] Vehículo ${placa} guardado en ${tableName}`);
    } else {
        showToast("Guardando en base de datos...", "info");

        // 1. Insertar en tabla específica
        const { error } = await supabaseClient.from(tableName).insert(newVehicle);

        if (error) {
            console.error(error);
            showToast("Error al guardar: " + error.message, "error");
            return;
        }

        // 2. Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'REGISTRO_VEHICULO',
            details: { placa, tabla: tableName, usuario: currentUser?.email },
            user_email: currentUser?.email
        });

        showToast("Vehículo registrado exitosamente.");
    }

    closeRuntModal();
    // Redirigir a la vista de flota correspondiente
    showFleet(cat);
}

// Nueva función para manejar las 3 vistas de flota
window.currentFleetCategory = 'PEPSICARGO'; // Default

function showFleet(category) {
    window.currentFleetCategory = category;

    // Convertir código a Título Amigable
    let title = 'Gestión de Flota';
    if (category === 'PEPSICARGO') title = 'Flota PepsiCargo';
    else if (category === 'PROPIA') title = 'Flota Propia';
    else if (category === 'CORP') title = 'Vehículos Corporativos';

    // Reutilizar la sección de flota existente pero cambiar título
    showSection('fleet'); // Esto ya maneja la visibilidad y active class (aunque active class necesita ajuste)

    // Ajuste manual de título si existe un elemento h2 dentro de fleet (asumimos que sí o lo creamos dinamicamente)
    // Para simplificar, asumimos que loadFleetData se encargará de renderizar encabezados si es necesario
    // O buscamos el h2 existente. En index.html no vimos el h2 de fleet section, pero asumimos que está.

    // Disparar carga de datos
    loadFleetData();
}

async function fetchRealData() {
    if (isDemoMode) return MOCK_FLOTA;

    // Combinar las 3 tablas para el Dashboard Global
    const t1 = supabaseClient.from('gestion_vehiculos_pepsicargo').select('*');
    const t2 = supabaseClient.from('gestion_vehiculos_flota_propia').select('*');
    const t3 = supabaseClient.from('gestion_vehiculos_corporativos').select('*');

    const [r1, r2, r3] = await Promise.all([t1, t2, t3]);

    const allVehicles = [
        ...(r1.data || []),
        ...(r2.data || []),
        ...(r3.data || [])
    ];

    return allVehicles;
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

// --- GESTIÓN DOCUMENTAL (PEPSICARGO) ---

function promptUpload(placa, type) {
    const modal = document.getElementById('modal-upload-doc');
    if (!modal) return;

    const title = document.getElementById('upload-doc-title');
    document.getElementById('upload-placa').value = placa;
    document.getElementById('upload-type').value = type;

    // Buscar datos actuales para pre-llenar
    const vh = window.allFleetData.find(v => v.placa === placa);
    if (vh) {
        document.getElementById('upload-fecha-exp').value = vh[`${type}_expedicion`] || '';
        document.getElementById('upload-fecha-venc').value = vh[`${type}_vencimiento`] || '';
    } else {
        document.getElementById('upload-fecha-exp').value = '';
        document.getElementById('upload-fecha-venc').value = '';
    }

    document.getElementById('upload-file').value = '';

    title.innerHTML = `<i data-lucide="edit"></i> Gestionar ${type.toUpperCase()} - ${placa}`;
    modal.style.display = 'flex';
    lucide.createIcons();
}

function closeUploadModal() {
    const modal = document.getElementById('modal-upload-doc');
    if (modal) modal.style.display = 'none';
}

async function submitDocUpload() {
    const placa = document.getElementById('upload-placa').value;
    const type = document.getElementById('upload-type').value;
    const fExp = document.getElementById('upload-fecha-exp').value;
    const fVenc = document.getElementById('upload-fecha-venc').value;
    const fileInput = document.getElementById('upload-file');
    const file = fileInput.files[0];

    if (!fExp || !fVenc) {
        alert("Por favor ingresa ambas fechas.");
        return;
    }

    showToast("Procesando...", "info");

    let fileUrl = null;

    // 1. Subir Archivo (si existe)
    if (file) {
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            alert("El archivo excede 50MB.");
            return;
        }

        const ext = file.name.split('.').pop();
        const fileName = `${placa}/${type}_${Date.now()}.${ext}`;

        showToast("Subiendo archivo...", "info");

        try {
            const { data, error } = await supabaseClient
                .storage
                .from('documentos')
                .upload(fileName, file, { cacheControl: '3600', upsert: true });

            if (error) throw error;

            // Get Public URL
            const { data: { publicUrl } } = supabaseClient
                .storage
                .from('documentos')
                .getPublicUrl(fileName);

            fileUrl = publicUrl;
        } catch (err) {
            console.error("Upload Error:", err);
            showToast("Error subiendo archivo: " + err.message, "error");
            return;
        }
    }

    // 2. Actualizar Base de Datos
    const updateData = {};
    updateData[`${type}_expedicion`] = fExp;
    updateData[`${type}_vencimiento`] = fVenc;
    if (fileUrl) updateData[`${type}_archivo`] = fileUrl;

    // Determinar tabla destino dinámicamente
    let tableName = 'gestion_vehiculos_pepsicargo';
    if (window.currentFleetCategory === 'PROPIA') tableName = 'gestion_vehiculos_flota_propia';
    if (window.currentFleetCategory === 'CORP') tableName = 'gestion_vehiculos_corporativos';

    try {
        const { error } = await supabaseClient
            .from(tableName)
            .update(updateData)
            .eq('placa', placa);

        // Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'CARGA_DOCUMENTO_MANUAL',
            details: { placa, tipo: type, fecha_exp: fExp, fecha_venc: fVenc, usuario: currentUser?.email },
            user_email: currentUser?.email
        });

        showToast("Documento actualizado correctamente.");
        closeUploadModal();
        loadFleetData(); // Refresh UI

    } catch (err) {
        console.error("DB Error:", err);
        showToast("Error guardando datos: " + err.message, "error");
    }
}
