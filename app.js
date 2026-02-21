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
    document.getElementById('driver-form')?.addEventListener('submit', handleDriverOnboarding);

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
    try {
        await loadInitialData();
        showAppScreen();
        showSection('dashboard');
    } catch (err) {
        console.error("Error cargando datos iniciales:", err);
        alert("Error cargando los datos del sistema: " + err.message);
        // Aún así permitimos entrar para no bloquear, o mostramos error fatal.
        // En este caso, mostramos app screen pero con alerta.
        showAppScreen();
    }
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

        // EXCLUIR INACTIVOS DEL CONTEO GLOBAL (Vehículos y Conductores)
        // Primero aseguramos que todos tengan un _type si vienen de MOCK (demo)
        rawData.forEach(item => {
            if (!item._type) item._type = 'VEHICLE';
        });

        const data = rawData.filter(item => {
            const isActive = item._type === 'VEHICLE' ? item.estado === 'ACTIVO' : item.estado_conductor === 'ACTIVO';
            return isActive;
        });

        let stats = { red: 0, yellow: 0, green: 0, total: data.length };
        let catCounts = { 'PEPSICARGO': 0, 'PROPIA': 0, 'CORP': 0 };
        let sedeCounts = {};
        dashboardAlertsCache = [];

        const vencimientosTbody = document.getElementById('vencimientos-body');
        if (vencimientosTbody) vencimientosTbody.innerHTML = '';

        data.forEach(item => {
            // Conteo por Categoría
            const cat = item.categoria || item.categoria_empresa;
            if (catCounts[cat] !== undefined) {
                catCounts[cat]++;
            }

            // Conteo por Sede
            const sedeName = item.sede ? item.sede.replace('_', ' ').toUpperCase() : 'S/D';
            sedeCounts[sedeName] = (sedeCounts[sedeName] || 0) + 1;

            const hasVencidos = { red: false, yellow: false };

            if (item._type === 'VEHICLE') {
                // Procesar Documentos de Vehículo
                if (item.categoria === 'PEPSICARGO') {
                    checkAndTrackStatus(item.soat_vencimiento, 'SOAT', item, stats, vencimientosTbody, hasVencidos);
                    checkAndTrackStatus(item.rtm_vencimiento, 'RTM', item, stats, vencimientosTbody, hasVencidos);
                    checkAndTrackStatus(item.fumigacion_vencimiento, 'Fumigación', item, stats, vencimientosTbody, hasVencidos);
                    checkAndTrackStatus(item.sanidad_vencimiento, 'Sanidad', item, stats, vencimientosTbody, hasVencidos);
                } else {
                    checkAndTrackStatus(item.soat_vencimiento, 'SOAT', item, stats, vencimientosTbody, hasVencidos);
                    checkAndTrackStatus(item.rtm_vencimiento, 'RTM', item, stats, vencimientosTbody, hasVencidos);
                }
            } else if (item._type === 'DRIVER') {
                // Procesar Documentos de Conductor
                checkAndTrackStatus(item.licencia_veh_vigencia, 'Licencia C', item, stats, vencimientosTbody, hasVencidos);
                checkAndTrackStatus(item.manipulacion_alimentos_vencimiento, 'Alimentos', item, stats, vencimientosTbody, hasVencidos);

                if (item.categoria_empresa === 'PEPSICARGO') {
                    checkAndTrackStatus(item.curso_sas_vencimiento, 'Curso SAS', item, stats, vencimientosTbody, hasVencidos);
                }
            }

            if (!hasVencidos.red && !hasVencidos.yellow) stats.green++;
        });

        // Actualizar Contadores UI Principales
        if (document.getElementById('count-danger')) document.getElementById('count-danger').innerText = stats.red;
        if (document.getElementById('count-warning')) document.getElementById('count-warning').innerText = stats.yellow;
        if (document.getElementById('count-success')) document.getElementById('count-success').innerText = stats.green;
        if (document.getElementById('count-total')) document.getElementById('count-total').innerText = stats.total;

        // Actualizar Contadores por Categoría
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

    // Diferenciar entre Vehículo (placa) y Conductor (cedula)
    const identifier = vh.placa || vh.cedula;
    const subIdentifier = vh.marca || vh.nombre_completo || 'N/A';
    const categoria = vh.categoria || vh.categoria_empresa || 'N/A';

    tr.innerHTML = `
        <td style="border-radius: 8px 0 0 8px; padding: 12px;">
            <div style="font-weight:700; color:var(--accent-green);">${identifier}</div>
            <div style="font-size:0.7rem; color:var(--text-muted);">${subIdentifier}</div>
        </td>
        <td><span class="role-tag" style="background:rgba(0,168,89,0.1); color:var(--accent-green); border:1px solid rgba(0,168,89,0.2);">${categoria}</span></td>
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
        const identifier = item.vh.placa || item.vh.cedula;
        const matchesPlaca = identifier.includes(placaQ);
        const matchesSede = !sedeQ || (item.vh.sede === sedeQ); // Sede only applies to vehicles
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
        const identifier = item.vh.placa || item.vh.cedula;
        const matchesPlaca = identifier.includes(placaQ);
        const matchesSede = !sedeQ || (item.vh.sede === sedeQ); // Sede only applies to vehicles
        const matchesDoc = !docQ || (item.type.toUpperCase() === docQ);
        return matchesPlaca && matchesSede && matchesDoc;
    });

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "IDENTIFICADOR,DESCRIPCION,CATEGORIA,SEDE,DOCUMENTO,VENCIMIENTO,DIAS_RESTANTES\n";

    dataToExport.forEach(item => {
        const identifier = item.vh.placa || item.vh.cedula;
        const subIdentifier = item.vh.marca || item.vh.nombre_completo || '';
        const category = item.vh.categoria || item.vh.categoria_empresa || '';
        const sede = item.vh.sede || '';

        const row = [
            identifier,
            subIdentifier,
            category,
            sede,
            item.type,
            item.date,
            item.diff
        ].map(field => `"${String(field).replace(/"/g, '""')}"`).join(","); // CSV escape
        csvContent += row + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `alertas_doc_tracker_${new Date().toISOString().split('T')[0]}.csv`);
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

    // Filter out drivers for the inventory table
    const vehiclesOnly = data.filter(item => {
        // Si no tiene _type (viene de carga individual de flota), lo tratamos como VEHÍCULO
        if (!item._type) return true;
        return item._type === 'VEHICLE';
    });

    // USAR SIEMPRE LA TABLA DETALLADA UNIFICADA
    renderUnifiedFleetTable(tbody, vehiclesOnly);
    lucide.createIcons();
}

// --- RENDER UNIFIED FLEET TABLE ---
// --- RENDER UNIFIED FLEET TABLE ---
function renderUnifiedFleetTable(tbody, data) {
    const table = tbody.closest('table');
    const thead = table ? table.querySelector('thead') : null;

    if (thead) {
        thead.innerHTML = `
            <tr style="background: rgba(0,0,0,0.2);">
                <th colspan="7" style="border:none;"></th>
                
                <th colspan="3" style="text-align:center; border-bottom: 2px solid var(--accent-blue); color: var(--accent-blue); padding: 10px; font-size: 0.95rem; font-weight:800; letter-spacing: 1.5px;">DOCUMENTACIÓN SOAT</th>
                <th colspan="3" style="text-align:center; border-bottom: 2px solid var(--accent-purple); color: var(--accent-purple); padding: 10px; font-size: 0.95rem; font-weight:800; letter-spacing: 1.5px;">DOCUMENTACIÓN RTM</th>
                ${window.currentFleetCategory !== 'CORP' ? `
                <th colspan="4" style="text-align:center; border-bottom: 2px solid var(--accent-green); color: var(--accent-green); padding: 10px; font-size: 0.95rem; font-weight:800; letter-spacing: 1.5px;">REQUISITOS FUMIGACIÓN</th>
                <th colspan="4" style="text-align:center; border-bottom: 2px solid #FFD700; color: #FFD700; padding: 10px; font-size: 0.95rem; font-weight:800; letter-spacing: 1.5px;">REQUISITOS SANIDAD</th>
                ` : ''}
                <th style="min-width:80px; text-transform: uppercase; font-weight:800; text-align:center; font-size: 0.85rem; border-bottom: 2px solid white; color: white; padding: 10px;">Activo</th>
                <th colspan="23" style="text-align:center; border-bottom: 2px solid #00D1FF; color: #00D1FF; padding: 10px; font-size: 0.95rem; font-weight:800; letter-spacing: 1.5px;">DATOS TÉCNICOS ADICIONALES (RUNT)</th>
                <th style="border:none;"></th>
            </tr>
            <tr>
                <th style="min-width:100px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.95rem; letter-spacing: 1px;">Placa</th>
                <th style="min-width:110px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.95rem;">Marca</th>
                <th style="min-width:100px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem;">CLASE VH</th>
                <th style="min-width:90px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem; border-right:2px solid var(--border-color);">Modelo</th>
                <th style="min-width:120px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem;">Propietario / NIT</th>
                <th style="min-width:110px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem;">Categoría</th>
                <th style="min-width:120px; text-transform: uppercase; font-weight:800; color: var(--warning); font-size: 0.85rem;">Sede Operativa</th>
                
                <!-- SOAT -->
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Expedición</th>
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Vencimiento</th>
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:800; border-right:1px solid var(--border-color); font-size: 0.8rem;">Vigencia</th>
                
                <!-- RTM -->
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Expedición</th>
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Vencimiento</th>
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:800; border-right:1px solid var(--border-color); font-size: 0.8rem;">Vigencia</th>
                
                ${window.currentFleetCategory !== 'CORP' ? `
                <!-- Fumigación -->
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:800; text-align:center; font-size: 0.8rem;">Cargar</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Expedición</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Vencimiento</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:800; border-right:1px solid var(--border-color); font-size: 0.8rem;">Vigencia</th>
                
                <!-- Sanidad -->
                <th style="color:#FFD700; text-transform: uppercase; font-weight:800; text-align:center; font-size: 0.8rem;">Cargar</th>
                <th style="color:#FFD700; text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Expedición</th>
                <th style="color:#FFD700; text-transform: uppercase; font-weight:800; font-size: 0.8rem;">Vencimiento</th>
                <th style="color:#FFD700; text-transform: uppercase; font-weight:800; border-right:1px solid var(--border-color); font-size: 0.8rem;">Vigencia</th>
                ` : ''}
                
                <!-- ACCIONES (NUEVO ORDEN) -->
                <th style="min-width:80px; text-transform: uppercase; font-weight:800; text-align:center; font-size: 0.85rem; border-right:2px solid var(--border-color);">Activo</th>

                <!-- NUEVAS COLUMNAS TÉCNICAS -->
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">VIN</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Motor</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Línea</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Color</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Combustible</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Cilindraje</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Carga (kg)</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Pasajeros</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Ejes</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Peso Bruto</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Nro Chasis</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Nro Serie</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Carrocería</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Servicio</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Clase Vehículo</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Puertas</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Licencia Tránsito</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Estado RUNT</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Fecha Matrícula</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Repotenciado</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">Gravámenes</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">SOAT Estado</th>
                <th style="color:#00D1FF; text-transform: uppercase; font-size: 0.75rem; font-weight:800;">RTM Estado</th>
            </tr>
        `;
    }


    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${window.currentFleetCategory === 'CORP' ? 35 : 43}" style="text-align:center; padding: 2rem; color: var(--text-muted); font-size: 1rem;">No hay vehículos registrados en esta categoría.</td></tr>`;
        return;
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
            <!-- Placa (Estandarizado) -->
            <td>
                <div style="font-size:0.85rem; color:white; text-transform: uppercase; letter-spacing:0.5px;">${vh.placa}</div>
            </td>
            <!-- Marca (Estandarizado) -->
            <td>
                <div style="font-size:0.85rem; color:white;">${vh.marca || 'GENÉRICO'}</div>
            </td>
            <!-- Clase VH (Estandarizado) -->
            <td>
                <div style="font-size:0.85rem; color:white;">${vh.clase_vehiculo || vh.clase || '--'}</div>
            </td>
            <!-- Modelo (Estandarizado) -->
            <td style="border-right:2px solid var(--border-color);">
                <div style="font-size:0.85rem; color:white;">${vh.modelo || '--'}</div>
            </td>

            <td><div style="font-size:0.85rem;">${vh.nit_cedula || vh.propietario || '--'}</div></td>
            <td><div style="font-size:0.85rem;">${vh.categoria || '--'}</div></td>
            <td><div style="font-size:0.85rem; color:var(--warning); letter-spacing:0.5px;">${vh.sede ? vh.sede.replace('_', ' ') : '--'}</div></td>
            
            <!-- SOAT -->
            <td style="font-size:0.85rem; color:white; font-weight:600;">${vh.soat_expedicion || '--'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:bold;">${vh.soat_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${soat.color}; color:#000; font-weight:800; font-size:0.75rem">${soat.text}</span></td>
            
            <!-- RTM -->
            <td style="font-size:0.85rem; color:white; font-weight:600;">${vh.rtm_expedicion || '--'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:bold;">${vh.rtm_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${rtm.color}; color:#000; font-weight:800; font-size:0.75rem">${rtm.text}</span></td>
            
            ${window.currentFleetCategory !== 'CORP' ? `
            <!-- Fumigación -->
            <td style="text-align:center;">
                 <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
                    ${vh.fumigacion_archivo ? `
                        <button class="btn-icon" style="background:rgba(0,168,89,0.1); border-color:var(--accent-green);" onclick="window.open('${vh.fumigacion_archivo}?t=${Date.now()}', '_blank')" title="Consultar Documento">
                            <i data-lucide="folder-open" style="color:var(--accent-green); width:14px;"></i>
                        </button>
                        <button class="btn-icon" style="background:rgba(0,168,89,0.1); border-color:var(--accent-green);" onclick="promptUpload('${vh.placa}', 'fumigacion')" title="Editar Datos/Archivo">
                            <i data-lucide="edit-3" style="color:var(--accent-green); width:14px;"></i>
                        </button>
                    ` : `
                        <button class="btn-icon" onclick="promptUpload('${vh.placa}', 'fumigacion')" title="Cargar Documento">
                            <i data-lucide="upload-cloud" style="color:var(--text-muted); width:14px;"></i>
                        </button>
                    `}
                 </div>
            </td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${vh.fumigacion_expedicion || '--'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:bold;">${vh.fumigacion_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${fum.color}; color:#000; font-weight:800; font-size:0.75rem">${fum.text}</span></td>

            <!-- Sanidad -->
            <td style="text-align:center;">
                 <div style="display:flex; gap:4px; justify-content:center; align-items:center;">
                    ${vh.sanidad_archivo ? `
                        <button class="btn-icon" style="background:rgba(255,215,0,0.1); border-color:#FFD700;" onclick="window.open('${vh.sanidad_archivo}?t=${Date.now()}', '_blank')" title="Consultar Documento">
                            <i data-lucide="folder-open" style="color:#FFD700; width:14px;"></i>
                        </button>
                        <button class="btn-icon" style="background:rgba(255,215,0,0.1); border-color:#FFD700;" onclick="promptUpload('${vh.placa}', 'sanidad')" title="Editar Datos/Archivo">
                            <i data-lucide="edit-3" style="color:#FFD700; width:14px;"></i>
                        </button>
                    ` : `
                        <button class="btn-icon" onclick="promptUpload('${vh.placa}', 'sanidad')" title="Cargar Documento">
                            <i data-lucide="upload-cloud" style="color:var(--text-muted); width:14px;"></i>
                        </button>
                    `}
                 </div>
            </td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${vh.sanidad_expedicion || '--'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:bold;">${vh.sanidad_vencimiento || '--'}</td>
            <td style="border-right:1px solid var(--border-color);"><span class="status-pill" style="background:${san.color}; color:#000; font-weight:800; font-size:0.75rem">${san.text}</span></td>
            ` : ''}
            
            <!-- TOGGLE ACTIVO (NUEVO ORDEN: DESPUÉS DE SANIDAD) -->
            <td style="text-align:center; border-right:2px solid var(--border-color);">
                <div style="display:flex; justify-content:center; align-items:center;">
                    <label class="switch" title="${isActive ? 'Desactivar' : 'Activar'}" style="margin:0;">
                        <input type="checkbox" ${isActive ? 'checked' : ''} onchange="toggleVehicleStatus('${vh.placa}', this.checked, '${window.currentFleetCategory}')">
                        <span class="slider"></span>
                    </label>
                </div>
            </td>
            
            <!-- DATOS TÉCNICOS EXTRA (VALORES EN BLANCO) -->
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.vin || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.motor || vh.numero_motor || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.linea || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.color || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.combustible || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.cilindraje || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.capacidad_carga || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.capacidad_pasajeros || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.ejes || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.peso_bruto || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.numero_chasis || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.numero_serie || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.tipo_carroceria || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.tipo_servicio || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.clase || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.numero_puertas || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.nro_licencia_transito || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.estado_runt || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.fecha_matricula || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.repotenciado || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.tiene_gravamenes || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.soat_estado || '--'}</div></td>
            <td><div style="font-size:0.75rem; color:white; font-weight:500;">${vh.rtm_estado || '--'}</div></td>
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
        await loadFleetData(); // Esperar a que cargue la flota actualizada
        await renderDashboard(); // Forzar actualización del Dashboard
    } catch (err) {
        console.error(err);
        showToast("Error actualizando estado", "error");
    }
}

async function refreshDashboard() {
    const btn = document.getElementById('btn-refresh-dash');
    if (btn) btn.classList.add('spin-anim'); // Asumimos clase CSS para rotar

    showToast("Actualizando indicadores...", "info");
    await loadFleetData();
    await renderDashboard();

    if (btn) setTimeout(() => btn.classList.remove('spin-anim'), 1000);
    showToast("Dashboard actualizado.");
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

// Función global para obtener TODOS los datos (Dashboard)
async function fetchRealData() {
    try {
        const p1 = supabaseClient.from('gestion_vehiculos_pepsicargo').select('*');
        const p2 = supabaseClient.from('gestion_vehiculos_flota_propia').select('*');
        const p3 = supabaseClient.from('gestion_vehiculos_corporativos').select('*');
        const p4 = supabaseClient.from('vista_conductores_vencimientos').select('*');

        const [r1, r2, r3, r4] = await Promise.all([p1, p2, p3, p4]);

        if (r1.error) console.warn("Error Pepsicargo:", r1.error);
        if (r2.error) console.warn("Error Propia:", r2.error);
        if (r3.error) console.warn("Error Corp:", r3.error);
        if (r4.error) console.warn("Error Conductores:", r4.error);

        const d1 = r1.data || [];
        const d2 = r2.data || [];
        const d3 = r3.data || [];
        const d4 = r4.data || [];

        // Marcamos el tipo para que renderDashboard sepa cómo procesar
        d1.forEach(v => v._type = 'VEHICLE');
        d2.forEach(v => v._type = 'VEHICLE');
        d3.forEach(v => v._type = 'VEHICLE');
        d4.forEach(d => d._type = 'DRIVER');

        return [...d1, ...d2, ...d3, ...d4];
    } catch (err) {
        console.error("Error en fetchRealData:", err);
        return [];
    }
}

async function loadFleetData() {
    const cat = window.currentFleetCategory || 'PEPSICARGO';

    // Inyectar botón de exportación si no existe
    let exportBtn = document.getElementById('btn-export-excel');
    if (!exportBtn) {
        const headerAction = document.querySelector('.section-container h2');
        if (headerAction) {
            const btnGroup = document.createElement('div');
            btnGroup.style.display = 'flex';
            btnGroup.style.gap = '10px';
            btnGroup.style.float = 'right';
            btnGroup.innerHTML = `
                <button id="btn-export-excel" class="secondary" title="Exportar a Excel">
                    <i data-lucide="download" style="width:16px;"></i> Exportar
                </button>
            `;
            headerAction.appendChild(btnGroup);
            lucide.createIcons();

            document.getElementById('btn-export-excel').onclick = () => exportToExcel(window.currentFleetData, cat);
        }
    }

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

    // --- REGLA RTM VEHÍCULOS NUEVOS ---
    if (data.rtm === 'No registrado' || !data.rtm_vencimiento) {
        const fechaMatriculaStr = data.datos_tecnicos?.fecha_matricula;
        const categoria = document.getElementById('f_categoria').value;

        if (fechaMatriculaStr && fechaMatriculaStr !== '-') {
            try {
                // Formato esperado de API: DD/MM/YYYY
                const parts = fechaMatriculaStr.split('/');
                if (parts.length === 3) {
                    let year = parseInt(parts[2]);
                    let month = parts[1];
                    let day = parts[0];

                    // Aplicar regla: +2 años Pepsi/Propia, +5 años Corp
                    const añosSumar = (categoria === 'CORP') ? 5 : 2;
                    const rtmEstimada = `${day}/${month}/${year + añosSumar}`;

                    data.rtm = rtmEstimada;
                    data.rtm_vencimiento = rtmEstimada;
                    data.rtm_estimada = true; // Flag para UI
                    console.log(`[RTM] Calculada estimada (+${añosSumar} años):`, rtmEstimada);
                }
            } catch (e) {
                console.error("Error calculando RTM estimada:", e);
            }
        }
    }
    // ----------------------------------

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
                    <span style="font-weight: bold; color: ${data.rtm_estimada ? 'var(--accent-blue)' : (data.rtm === 'No registrado' ? 'var(--danger)' : 'var(--success)')}">
                        ${data.rtm} ${data.rtm_estimada ? '<small style="display:block; font-size:0.7rem; color:var(--text-muted); font-weight:normal;">(Estimado por Matrícula)</small>' : ''}
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

function toggleTechnicalFields() {
    const categoria = document.getElementById('f_categoria').value;
    const techFields = document.getElementById('technical-fields');

    // Ocultar campos manuales para FLOTA PROPIA y VEHÍCULOS CORPORATIVOS
    // Ya que la API trae todo automáticamente. Solo mostrar si es PEPSICARGO (opcional) o si el usuario quiere editar
    // Según requerimiento: "esa parte quítala para esas dos opciones"
    if (categoria === 'PROPIA' || categoria === 'CORP') {
        techFields.style.display = 'none';
        // Limpiar campos para evitar envío de datos basura si se ocultaron
        document.getElementById('f_vin').value = '';
        document.getElementById('f_carga').value = '';
    } else {
        // Para PEPSICARGO u otros, podría ser útil verlos, o si el usuario prefiere manual
        // Por defecto lo dejaremos oculto o visible según preferencia anterior, 
        // pero la instrucción fue específica para PROPIA y CORP quitarlos.
        // Lo dejaremos visible para PEPSICARGO por si acaso.
        techFields.style.display = 'block';
    }
}

function displaySyncResults(data) {
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    emptyDiv.style.display = 'none';
    resultsDiv.style.display = 'block';

    window.currentRuntData = data;
    const tech = data.datos_tecnicos || {};

    // VISTA ULTRA-RESUMIDA (TOP 6)
    resultsDiv.innerHTML = `
        <div class="data-frame-content">
            <h3 style="color: var(--accent-green); margin-bottom: 1rem; font-size: 1rem; display: flex; align-items: center; gap: 8px;">
                <i data-lucide="check-circle"></i> Validación Rápida
            </h3>
            
            <div class="sync-grid" style="display: grid; grid-template-columns: 1fr; gap: 0.8rem; font-size: 0.9rem;">
                
                <div class="data-item">
                    <span class="label">1. Placa</span>
                    <span class="value highlight" style="font-size: 1.2rem;">${data.placa}</span>
                </div>

                <div class="data-item">
                    <span class="label">2. Marca</span>
                    <span class="value">${data.marca}</span>
                </div>

                <div class="data-item">
                    <span class="label">3. Modelo</span>
                    <span class="value">${data.modelo}</span>
                </div>

                <div class="data-item">
                    <span class="label">4. Vencimiento SOAT</span>
                    <span class="value" style="color: ${data.soat_estado === 'VIGENTE' ? 'var(--success)' : 'var(--danger)'}">${data.soat || 'No encontrado'}</span>
                </div>

                <div class="data-item">
                    <span class="label">5. Vencimiento RTM</span>
                    <span class="value" style="color: ${data.rtm_estado === 'APROBADA' || data.rtm_estado === 'VIGENTE' ? 'var(--success)' : 'var(--danger)'}">${data.rtm || 'No registrado'}</span>
                </div>

                <div class="data-item">
                    <span class="label">6. Estado RUNT</span>
                    <span class="value" style="color: ${tech.estado_vehiculo === 'ACTIVO' ? 'var(--success)' : 'var(--warning)'}; font-weight: bold;">${tech.estado_vehiculo || '-'}</span>
                </div>

            </div>

            <div style="margin-top: 1.5rem;">
                <button class="primary" onclick="confirmarRegistroRunt()" style="width: 100%; justify-content: center; background: var(--accent-green); color: black; font-weight: bold; height: 3rem;">
                    Confirmar Registro
                </button>
            </div>
            
            <div style="margin-top: 0.5rem; text-align: center; font-size: 0.75rem; color: var(--text-muted);">
                * Se guardarán los 27 datos completos automáticamente.
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
        propietario: nitInput || data.propietario || 'S/D',
        sede: sede,
        marca: data.marca,
        modelo: data.modelo,
        linea: data.linea || null,
        clase_vehiculo: data.clase || null,
        color: data.color || null,
        combustible: data.combustible || null,
        cilindraje: data.cilindraje || null,
        vin: data.datos_tecnicos?.vin || null,
        numero_motor: data.datos_tecnicos?.motor || null,
        numero_chasis: data.datos_tecnicos?.chasis || null,
        numero_serie: data.datos_tecnicos?.serie || null,
        ejes: parseInt(data.datos_tecnicos?.ejes || 0),
        capacidad_pasajeros: parseInt(data.datos_tecnicos?.pasajeros || 0),
        capacidad_carga: parseFloat(data.datos_tecnicos?.carga || 0),
        peso_bruto: parseFloat(data.datos_tecnicos?.peso_bruto || 0),
        tipo_carroceria: data.datos_tecnicos?.carroceria || null,
        tipo_servicio: data.datos_tecnicos?.servicio || null,
        numero_puertas: parseInt(data.datos_tecnicos?.puertas || 0),
        nro_licencia_transito: data.datos_tecnicos?.licencia || null,
        repotenciado: data.datos_tecnicos?.repotenciado || null,
        tiene_gravamenes: data.datos_tecnicos?.gravamenes || null,
        estado_runt: data.datos_tecnicos?.estado_vehiculo || null,
        fecha_matricula: formatDateRuntToIso(data.datos_tecnicos?.fecha_matricula),
        soat_vencimiento: formatDateRuntToIso(finalSoat),
        rtm_vencimiento: formatDateRuntToIso(finalRtm),
        soat_expedicion: formatDateRuntToIso(data.soat_expedicion) || null,
        rtm_expedicion: formatDateRuntToIso(data.rtm_expedicion) || null,
        soat_estado: data.soat_estado,
        rtm_estado: data.rtm_estado,
        api_raw_data: data.api_raw_data || null,
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
    }

    showToast("Vehículo registrado exitosamente.");

    // FLUJO CONTINUO: MOSTRAR PANTALLA DE ÉXITO EN EL PANEL DE RESULTADOS
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    resultsDiv.innerHTML = `
        <div class="success-screen" style="text-align: center; padding: 2rem;">
            <div style="background: rgba(52, 199, 89, 0.1); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                <i data-lucide="check-circle" size="48" style="color: var(--success);"></i>
            </div>
            <h2 style="color: var(--success); margin-bottom: 0.5rem;">¡Registro Exitoso!</h2>
            <p style="color: var(--text-muted); margin-bottom: 2rem;">El vehículo <strong>${placa}</strong> ha sido guardado correctamente.</p>
            
            <div style="display: flex; flex-direction: column; gap: 1rem;">
                <button class="primary" onclick="resetOnboardingForm()" style="width: 100%; justify-content: center; background: var(--accent-blue);">
                    <i data-lucide="plus-circle"></i> Registrar Otro Vehículo
                </button>
                <button class="secondary" onclick="showFleet('${cat}')" style="width: 100%; justify-content: center;">
                    <i data-lucide="list"></i> Ver Inventario (${cat})
                </button>
            </div>
        </div>
    `;
    lucide.createIcons();
}

/**
 * Limpia el formulario de registro de vehículos y lo devuelve al estado inicial
 */
function resetOnboardingForm() {
    // 1. Limpiar campos del formulario
    const form = document.getElementById('onboarding-form');
    if (form) form.reset();

    // 2. Ocultar resultados y mostrar estado inicial
    const resultsDiv = document.getElementById('results-content');
    const emptyDiv = document.querySelector('.empty-results');

    if (resultsDiv) resultsDiv.style.display = 'none';
    if (emptyDiv) {
        emptyDiv.style.display = 'block';
        emptyDiv.innerHTML = `
            <i data-lucide="search" size="48" style="color:var(--text-muted)"></i>
            <h2 style="margin-top:1rem; color:var(--text-muted); font-size: 1.2rem;">Esperando Consulta</h2>
            <p style="color:var(--text-muted); font-size: 0.9rem;">Ingresa la placa y documento para validar con RUNT.</p>
        `;
    }

    // 3. Foco inmediato en Placa para siguiente vehículo
    const placaInput = document.getElementById('f_placa');
    if (placaInput) placaInput.focus();

    lucide.createIcons();
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


function updateUIForRole() {
    const mail = document.getElementById('user-mail');
    const rol = document.getElementById('current-rol');

    mail.innerText = currentUser.email;
    rol.innerText = currentRole;

    // Admin visibility
    const isAdmin = (currentRole === 'ADMIN' || currentRole === 'SUPER_ADMIN');
    const adminItems = document.querySelectorAll('.admin-only');
    adminItems.forEach(el => el.style.display = isAdmin ? 'flex' : 'none');

    // Header especifico de Admin
    const adminHeader = document.getElementById('header-admin');
    if (adminHeader) adminHeader.style.display = isAdmin ? 'block' : 'none';

    // Action restrictions
    const onboardingNav = document.querySelector('.nav-item[onclick*="onboarding"]');
    // Permitir a gestores también? Por ahora solo admin/gestor
    // if (onboardingNav) onboardingNav.style.display = restrictActions ? 'none' : 'flex';
}

function showDriverSection(category) {
    // 1. Ocultar todas las secciones
    document.querySelectorAll('section').forEach(s => s.style.display = 'none');

    // 2. Mostrar Contenedor de Conductores
    const driverSection = document.getElementById('section-drivers');
    if (driverSection) {
        driverSection.style.display = 'block';

        // Actualizar título de la sección
        const title = document.getElementById('driver-section-title');
        if (title) title.innerText = category === 'PEPSICARGO' ? 'Conductores PepsiCargo' : 'Conductores Flota Propia';

        // 3. Cargar datos específicos de conductores
        window.currentDriverCategory = category;
        loadDriversData(category);
    } else {
        console.error("❌ ERROR CRÍTICO: No se encontró la sección #section-drivers en el HTML");
    }

    // Update nav active state
    document.querySelectorAll('.nav-item').forEach(item => {
        item.classList.remove('active');
        if (item.getAttribute('onclick')?.includes(`'${category}'`) && item.getAttribute('onclick')?.includes('Driver')) {
            item.classList.add('active');
        }
    });
}

async function loadDriversData(category) {
    console.log("🚀 INICIANDO CARGA DE CONDUCTORES:", category);
    const tbody = document.getElementById('driver-table-body');
    if (!tbody) {
        console.error("❌ ERROR: No se encontró el elemento #driver-table-body");
        return;
    }

    // Forzar cabeceras de conductores antes de cargar para evitar confusión visual
    renderDriversTable(tbody, []);

    // Limpiar tabla mientras carga
    const currentCols = window.currentDriverCategory === 'PROPIA' ? 13 : 17;
    tbody.innerHTML = `<tr><td colspan="${currentCols}" style="text-align:center;">Cargando conductores...</td></tr>`;

    try {
        console.log("📡 Consultando Supabase: vista_conductores_vencimientos...");
        const { data, error } = await supabaseClient
            .from('vista_conductores_vencimientos')
            .select('*')
            .eq('categoria_empresa', category);

        if (error) {
            console.error("❌ ERROR SUPABASE:", error);
            throw error;
        }

        console.log("✅ Datos recibidos:", data);
        console.log("📊 Cantidad de registros:", data ? data.length : 0);

        const sortedData = (data || []).sort((a, b) => {
            // 1. Estado (ACTIVO < INACTIVO)
            if (a.estado_conductor !== b.estado_conductor) {
                return a.estado_conductor === 'ACTIVO' ? -1 : 1;
            }
            // 2. Nombre (A-Z)
            return (a.nombre_completo || "").localeCompare(b.nombre_completo || "");
        });

        window.allDriversData = sortedData;
        renderDriversTable(tbody, sortedData);
    } catch (err) {
        console.error("❌ EXCEPCIÓN EN loadDriversData:", err);
        const currentCols = window.currentDriverCategory === 'PROPIA' ? 13 : 17;
        tbody.innerHTML = `<tr><td colspan="${currentCols}" style="text-align:center; color:var(--danger);">Error cargando datos: ${err.message}</td></tr>`;
    }
}

function renderDriversTable(tbody, data) {
    const table = tbody.closest('table');
    const thead = table ? table.querySelector('thead') : null;

    // 1. Configurar Cabecera Específica para Conductores
    const isPropia = window.currentDriverCategory === 'PROPIA';
    const totalCols = isPropia ? 13 : 17;

    if (thead) {
        thead.innerHTML = `
            <tr style="background: rgba(0,0,0,0.2);">
                <th colspan="3" style="border:none;"></th>
                <th colspan="4" style="text-align:center; border-bottom: 2px solid var(--accent-blue); color: var(--accent-blue); padding: 8px; font-size: 0.85rem; font-weight:800; letter-spacing: 1px;">LICENCIA VEHÍCULO C</th>
                <th colspan="4" style="text-align:center; border-bottom: 2px solid var(--accent-green); color: var(--accent-green); padding: 8px; font-size: 0.85rem; font-weight:800; letter-spacing: 1px;">MANIPULACIÓN ALIMENTOS</th>
                ${!isPropia ? `
                <th colspan="4" style="text-align:center; border-bottom: 2px solid var(--accent-purple); color: var(--accent-purple); padding: 8px; font-size: 0.85rem; font-weight:800; letter-spacing: 1px;">CURSO SAS</th>
                ` : ''}
                <th colspan="2" style="text-align:center; border-bottom: 2px solid var(--danger); color: var(--danger); padding: 8px; font-size: 0.85rem; font-weight:800; letter-spacing: 1px;">ESTADO GENERAL</th>
            </tr>
            <tr>
                <th style="text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem;">Cédula</th>
                <th style="min-width:180px; text-transform: uppercase; font-weight:800; color: white; font-size: 0.85rem;">Nombre Completo</th>
                <th style="text-transform: uppercase; font-weight:800; color: var(--warning); font-size: 0.85rem; letter-spacing: 0.5px;">Sede</th>
                
                <!-- LICENCIA -->
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Cat</th>
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Exp</th>
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Venc</th>
                <th style="color:var(--accent-blue); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Días</th>

                <!-- ALIMENTOS -->
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Doc</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Exp</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Venc</th>
                <th style="color:var(--accent-green); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Días</th>

                ${!isPropia ? `
                <!-- SAS -->
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Doc</th>
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Exp</th>
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Venc</th>
                <th style="color:var(--accent-purple); text-transform: uppercase; font-weight:900; font-size: 0.8rem; letter-spacing: 0.3px;">Días</th>
                ` : ''}

                <th style="text-align:center; text-transform: uppercase; font-weight:900; color:var(--danger); font-size: 0.8rem; letter-spacing: 0.3px;">Multas</th>
                <th style="text-align:center; text-transform: uppercase; font-weight:900; color: white; font-size: 0.85rem; letter-spacing: 0.5px;">Estado</th>
            </tr>
        `;
    }

    tbody.innerHTML = '';

    if (!data || data.length === 0) {
        tbody.innerHTML = `<tr><td colspan="${totalCols}" style="text-align:center; padding: 2rem; color: var(--text-muted);">No hay registros en esta categoría.</td></tr>`;
        return;
    }

    data.forEach(d => {
        const tr = document.createElement('tr');
        if (d.estado_conductor === 'INACTIVO') {
            tr.classList.add('user-row-blocked');
        }


        // Helper para badges de días/estado
        const getDaysBadge = (days, status) => {
            if (days === null || days === undefined) return '<span style="color:var(--text-muted);">-</span>';

            let color = 'var(--text-muted)';
            if (status === 'VENCIDO') color = 'var(--danger)';
            else if (status === 'POR VENCER') color = 'var(--warning)';
            else if (status === 'VIGENTE') color = 'var(--success)';

            return `<span style="color:${color}; font-weight:700;">${days} días</span>`;
        };

        tr.innerHTML = `
            <td style="font-size:0.85rem; color:white; letter-spacing:0.5px;">${d.cedula}</td>
            <td style="font-size:0.85rem; color:white;">${d.nombre_completo}</td>
            <td style="font-size:0.85rem; color:var(--warning); letter-spacing:0.5px;">${d.sede || '-'}</td>

            <!-- Vehículo -->
            <td><span class="role-tag" style="background:rgba(255,255,255,0.1); color:white; border:1px solid rgba(255,255,255,0.2); padding: 4px 10px; min-width: 40px; text-align: center; display: inline-block;">${d.licencia_veh_categoria || '-'}</span></td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.licencia_veh_expedicion || '-'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.licencia_veh_vigencia || '-'}</td>
            <td style="text-align:center;">${getDaysBadge(d.dias_venc_vehiculo, d.estado_licencia_veh)}</td>

            <!-- Alimentos -->
            <td style="text-align:center;">
                <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                    ${d.manipulacion_alimentos_archivo ? `
                        <button class="btn-icon" style="background:rgba(0,168,89,0.15); border-color:var(--accent-green);" onclick="window.open('${d.manipulacion_alimentos_archivo}?t=${Date.now()}', '_blank')" title="Consultar Documento">
                            <i data-lucide="folder-open" style="color:var(--accent-green); width:14px;"></i>
                        </button>
                        <button class="btn-icon" style="background:rgba(0,168,89,0.1); border-color:var(--accent-green);" onclick="promptDriverUpload('${d.cedula}', 'manipulacion_alimentos')" title="Editar Datos/Archivo">
                            <i data-lucide="edit-3" style="color:var(--accent-green); width:14px;"></i>
                        </button>
                    ` : `
                        <button class="btn-icon" onclick="promptDriverUpload('${d.cedula}', 'manipulacion_alimentos')" title="Cargar Documento">
                            <i data-lucide="upload-cloud" style="color:var(--text-muted); width:14px;"></i>
                        </button>
                    `}
                </div>
            </td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.manipulacion_alimentos_expedicion || '-'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.manipulacion_alimentos_vencimiento || '-'}</td>
            <td style="text-align:center;">${getDaysBadge(d.dias_venc_alimentos, d.estado_alimentos)}</td>

            ${!isPropia ? `
            <!-- SAS -->
            <td style="text-align:center;">
                <div style="display:flex; gap:6px; justify-content:center; align-items:center;">
                    ${d.curso_sas_archivo ? `
                        <button class="btn-icon" style="background:rgba(255,255,255,0.1); border-color:white;" onclick="window.open('${d.curso_sas_archivo}?t=${Date.now()}', '_blank')" title="Consultar Documento">
                            <i data-lucide="folder-open" style="color:white; width:14px;"></i>
                        </button>
                        <button class="btn-icon" style="background:rgba(255,255,255,0.1); border-color:white;" onclick="promptDriverUpload('${d.cedula}', 'curso_sas')" title="Editar Datos/Archivo">
                            <i data-lucide="edit-3" style="color:white; width:14px;"></i>
                        </button>
                    ` : `
                        <button class="btn-icon" onclick="promptDriverUpload('${d.cedula}', 'curso_sas')" title="Cargar Documento">
                            <i data-lucide="upload-cloud" style="color:var(--text-muted); width:14px;"></i>
                        </button>
                    `}
                </div>
            </td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.curso_sas_expedicion || '-'}</td>
            <td style="font-size:0.85rem; color:white; font-weight:600;">${d.curso_sas_vencimiento || '-'}</td>
            <td style="text-align:center;">${getDaysBadge(d.dias_venc_sas, d.estado_sas)}</td>
            ` : ''}

            <!-- General -->
            <td style="text-align:center; color:${d.total_multas > 0 ? 'var(--danger)' : 'var(--text-muted)'}; font-weight:bold;">${d.total_multas}</td>
            <td style="text-align:center;">
                <label class="switch">
                    <input type="checkbox" ${d.estado_conductor === 'ACTIVO' ? 'checked' : ''} onchange="toggleDriverStatus('${d.cedula}', this.checked, this)">
                    <span class="slider"></span>
                </label>
            </td>
        `;
        tbody.appendChild(tr);
    });

    lucide.createIcons();
}

async function handleDriverOnboarding(e) {
    e.preventDefault();
    const cedula = document.getElementById('d_cedula').value.trim();
    const resultContainer = document.getElementById('driver-results');

    // Simplificar lógica de empresa y sede (Asumir seleccionados o default)
    const empresaSelect = document.getElementById('d_empresa');
    const empresa = empresaSelect ? empresaSelect.value : 'PEPSICARGO';

    const sedeSelect = document.getElementById('d_sede');
    const sede = sedeSelect ? sedeSelect.value : '';

    if (!cedula) {
        showToast("Ingrese un número de cédula válido", "error");
        return;
    }

    resultContainer.innerHTML = `
        <div style="text-align:center; padding: 2rem;">
            <div class="spinner"></div>
            <p style="margin-top:1rem; color:var(--text-muted);">Consultando RUNT...</p>
        </div>
    `;

    try {
        const response = await fetch(`http://127.0.0.1:5000/sync?placa=${cedula}&nit=NA&categoria=${empresa}&sede=${sede}&type=driver`);
        const data = await response.json();

        if (data.status === 'error') throw new Error(data.message);

        // Mostrar Resultado
        resultContainer.innerHTML = `
            <div style="padding: 1rem;">
                <h3 style="color:var(--accent-green); margin-bottom: 1rem;">Conductor Encontrado</h3>
                <div class="result-card" style="background:rgba(255,255,255,0.05); padding:1rem; border-radius:8px; margin-bottom:1rem;">
                    <div style="display:grid; grid-template-columns: 1fr; gap:0.5rem; font-size:0.9rem;">
                        <div><strong>Nombre:</strong> ${data.nombre_completo}</div>
                        <div><strong>Cédula:</strong> ${data.cedula}</div>
                        <div><strong>Estado RUNT:</strong> ${data.estado_conductor}</div>
                    </div>
                    
                    <div style="margin-top:1rem; padding-top:1rem; border-top:1px solid var(--border-color);">
                        <h4 style="font-size:0.85rem; color:var(--accent-blue); margin-bottom:0.5rem;">Licencias</h4>
                        <div style="font-size:0.85rem;">
                             <div style="margin-bottom:4px;">🚗 Licencia Encontrada: <strong style="color:var(--accent-green);">${data.licencia_veh_categoria || 'N/A'}</strong></div>
                             <div style="font-size:0.8rem; color:var(--text-muted);">Vencimiento RUNT: <strong style="color:var(--warning);">${data.licencia_veh_vigencia || '-'}</strong></div>
                        </div>
                    </div>
                </div>
                
                <button class="primary" onclick='confirmDriverRegistration(${JSON.stringify(data).replace(/'/g, "&#39;")})' style="width:100%;">
                    <i data-lucide="save"></i> Confirmar y Guardar
                </button>
            </div>
        `;
        lucide.createIcons();

    } catch (err) {
        console.error(err);
        resultContainer.innerHTML = `
            <div class="empty-results-driver" style="color:var(--danger)">
                <i data-lucide="alert-circle" size="40"></i>
                <p>Error: ${err.message}</p>
                <button class="secondary" onclick="document.getElementById('driver-form').reset()">Intentar de nuevo</button>
            </div>
        `;
        lucide.createIcons();
    }
}

async function confirmDriverRegistration(data) {
    try {
        // Mapeo exacto a schema_drivers.sql
        const record = {
            cedula: data.cedula,
            nombre_completo: data.nombre_completo,
            estado_conductor: data.estado_conductor,
            nro_inscripcion_runt: data.nro_inscripcion_runt,
            fecha_inscripcion_runt: formatDateForSupabase(data.fecha_inscripcion_runt),

            licencia_veh_nro: data.licencia_veh_nro,
            licencia_veh_categoria: data.licencia_veh_categoria,
            licencia_veh_vigencia: formatDateForSupabase(data.licencia_veh_vigencia),
            licencia_veh_expedicion: formatDateForSupabase(data.licencia_veh_expedicion),

            // Licencia moto eliminada segun requerimiento
            licencia_moto_nro: null,
            licencia_moto_categoria: null,
            licencia_moto_vigencia: null,
            licencia_moto_expedicion: null,

            total_multas: parseInt(data.total_multas || 0),
            total_tramites: parseInt(data.total_tramites || 0),
            paz_y_salvo: data.paz_y_salvo,

            categoria_empresa: data.categoria_empresa,
            sede: data.sede,
            api_raw_data: data.api_raw_data
        };

        const { error } = await supabaseClient
            .from('conductores_maestro')
            .upsert(record);

        if (error) throw error;

        // Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'REGISTRO_CONDUCTOR',
            details: {
                cedula: record.cedula,
                nombre: record.nombre_completo,
                categoria_empresa: record.categoria_empresa,
                usuario: currentUser?.email
            },
            user_email: currentUser?.email
        });

        showToast("Conductor registrado exitosamente.", "success");

        // FLUJO CONTINUO: MOSTRAR PANTALLA DE ÉXITO EN EL PANEL DE RESULTADOS
        const resultContainer = document.getElementById('driver-results');
        resultContainer.innerHTML = `
            <div class="success-screen" style="text-align: center; padding: 2rem;">
                <div style="background: rgba(52, 199, 89, 0.1); width: 80px; height: 80px; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 1.5rem;">
                    <i data-lucide="check-circle" size="48" style="color: var(--success);"></i>
                </div>
                <h2 style="color: var(--success); margin-bottom: 0.5rem;">¡Registro Exitoso!</h2>
                <p style="color: var(--text-muted); margin-bottom: 2rem;">El conductor <strong>${data.nombre_completo}</strong> ha sido guardado correctamente.</p>
                
                <div style="display: flex; flex-direction: column; gap: 1rem;">
                    <button class="primary" onclick="resetDriverForm()" style="width: 100%; justify-content: center; background: var(--accent-blue);">
                        <i data-lucide="user-plus"></i> Registrar Otro Conductor
                    </button>
                    <button class="secondary" onclick="showDriverSection('${data.categoria_empresa}')" style="width: 100%; justify-content: center;">
                        <i data-lucide="id-card"></i> Ver Listado (${data.categoria_empresa})
                    </button>
                </div>
            </div>
        `;
        lucide.createIcons();

    } catch (err) {
        console.error("Error guardando conductor:", err);
        showToast("Error al guardar: " + err.message, "error");
    }
}

/**
 * Limpia el formulario de registro de conductores y lo devuelve al estado inicial
 */
function resetDriverForm() {
    // 1. Limpiar campos del formulario
    const form = document.getElementById('driver-form');
    if (form) form.reset();

    // 2. Ocultar resultados y mostrar estado inicial
    const resultContainer = document.getElementById('driver-results');
    if (resultContainer) {
        resultContainer.innerHTML = `
            <div class="empty-results-driver">
                <i data-lucide="user-search" size="40"></i>
                <p>Ingresa la cédula para validar antecedentes y licencia.</p>
            </div>
        `;
    }

    // 3. Foco inmediato en Cédula para siguiente conductor
    const cedulaInput = document.getElementById('d_cedula');
    if (cedulaInput) cedulaInput.focus();

    lucide.createIcons();
}

/**
 * Normaliza fechas de DD/MM/YYYY a YYYY-MM-DD para Supabase.
 */
function formatDateForSupabase(dateStr) {
    if (!dateStr || dateStr === 'N/A' || dateStr === '-') return null;
    if (dateStr.includes('/')) {
        const parts = dateStr.split('/');
        if (parts.length === 3) {
            // Asumimos DD/MM/YYYY
            return `${parts[2]}-${parts[1].padStart(2, '0')}-${parts[0].padStart(2, '0')}`;
        }
    }
    return dateStr;
}

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
    < td > ${email}</td >
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

    // Asegurarnos de que no sea modo conductor
    const isDriverField = document.getElementById('upload-is-driver');
    if (isDriverField) isDriverField.value = 'false';

    // Buscar datos actuales para pre-llenar
    const vh = window.allFleetData.find(v => v.placa === placa);
    if (vh) {
        document.getElementById('upload-fecha-exp').value = vh[`${type} _expedicion`] || '';
        document.getElementById('upload-fecha-venc').value = vh[`${type} _vencimiento`] || '';
    } else {
        document.getElementById('upload-fecha-exp').value = '';
        document.getElementById('upload-fecha-venc').value = '';
    }

    document.getElementById('upload-file').value = '';

    title.innerHTML = `< i data - lucide="edit" ></i > Gestionar ${type.toUpperCase()} - ${placa} `;
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
    if (file) {
        if (file.size > 50 * 1024 * 1024) { // 50MB limit
            alert("El archivo excede 50MB.");
            return;
        }
        const ext = file.name.split('.').pop();
        // Usar la cédula/placa como prefijo principal para fácil identificación
        const fileName = `DOC_${placa}_${type.toUpperCase()}_${Date.now()}.${ext}`;

        showToast("Subiendo archivo...", "info");

        try {
            const { data, error } = await supabaseClient
                .storage
                .from('documentos')
                .upload(fileName, file, { cacheControl: '0', upsert: true });

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

    const isDriver = document.getElementById('upload-is-driver')?.value === 'true';

    try {
        if (isDriver) {
            const { error } = await supabaseClient
                .from('conductores_maestro')
                .update(updateData)
                .eq('cedula', placa); // placa aquí es la cédula

            if (error) throw error;
            showToast("Documento de conductor actualizado.");
            closeUploadModal();
            loadDriversData(window.currentDriverCategory);
        } else {
            // Determinar tabla destino dinámicamente para vehículos
            let tableName = 'gestion_vehiculos_pepsicargo';
            if (window.currentFleetCategory === 'PROPIA') tableName = 'gestion_vehiculos_flota_propia';
            if (window.currentFleetCategory === 'CORP') tableName = 'gestion_vehiculos_corporativos';

            const { error } = await supabaseClient
                .from(tableName)
                .update(updateData)
                .eq('placa', placa);

            if (error) throw error;
            showToast("Documento de vehículo actualizado.");
            closeUploadModal();
            loadFleetData(); // Refresh UI
        }

        // Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'CARGA_DOCUMENTO_MANUAL',
            details: { identifier: placa, tipo: type, is_driver: isDriver, usuario: currentUser?.email },
            user_email: currentUser?.email
        });

    } catch (err) {
        console.error("DB Error:", err);
        showToast("Error guardando datos: " + err.message, "error");
    }
}

function promptDriverUpload(cedula, type) {
    const modal = document.getElementById('modal-upload-doc');
    if (!modal) return;

    // Asegurarnos de tener el campo oculto para saber si es conductor
    let isDriverField = document.getElementById('upload-is-driver');
    if (!isDriverField) {
        isDriverField = document.createElement('input');
        isDriverField.type = 'hidden';
        isDriverField.id = 'upload-is-driver';
        modal.appendChild(isDriverField);
    }
    isDriverField.value = 'true';

    const title = document.getElementById('upload-doc-title');
    document.getElementById('upload-placa').value = cedula;
    document.getElementById('upload-type').value = type;

    // Buscar datos actuales
    const dr = window.allDriversData?.find(d => d.cedula === cedula);
    if (dr) {
        document.getElementById('upload-fecha-exp').value = dr[`${type}_expedicion`] || '';
        document.getElementById('upload-fecha-venc').value = dr[`${type}_vencimiento`] || '';
    }

    document.getElementById('upload-file').value = '';
    title.innerHTML = `<i data-lucide="user"></i> Gestionar ${type.replace('_', ' ').toUpperCase()} - ${cedula}`;
    modal.style.display = 'flex';
    lucide.createIcons();
}

async function toggleDriverStatus(cedula, isChecked, checkboxEl) {
    const status = isChecked ? 'ACTIVO' : 'INACTIVO';
    const tr = checkboxEl ? checkboxEl.closest('tr') : null;

    // Actualización inmediata (Optimistic UI)
    if (tr) {
        if (status === 'INACTIVO') {
            tr.classList.add('user-row-blocked');
        } else {
            tr.classList.remove('user-row-blocked');
        }
    }

    try {
        const { error } = await supabaseClient
            .from('conductores_maestro')
            .update({ estado_conductor: status })
            .eq('cedula', cedula);

        if (error) throw error;
        showToast(`Conductor ${status} con éxito`, "success");

        // Auditoría
        await supabaseClient.from('system_audit_logs').insert({
            action: 'CAMBIO_ESTADO_CONDUCTOR',
            details: { cedula, estado: status, usuario: currentUser?.email },
            user_email: currentUser?.email
        });

        // RE-ORDENAR LOCALMENTE TRAS CAMBIO EXITOSO
        if (window.allDriversData) {
            const driver = window.allDriversData.find(d => d.cedula === cedula);
            if (driver) driver.estado_conductor = status;

            const tbody = document.getElementById('driver-table-body');
            const sorted = [...window.allDriversData].sort((a, b) => {
                if (a.estado_conductor !== b.estado_conductor) return a.estado_conductor === 'ACTIVO' ? -1 : 1;
                return (a.nombre_completo || "").localeCompare(b.nombre_completo || "");
            });
            window.allDriversData = sorted;
            renderDriversTable(tbody, sorted);
        }

    } catch (err) {
        console.error("Error al cambiar estado:", err);
        showToast("No se pudo cambiar el estado", "error");

        // Revertir UI en caso de error
        if (tr) {
            if (status === 'INACTIVO') {
                tr.classList.remove('user-row-blocked');
            } else {
                tr.classList.add('user-row-blocked');
            }
        }
        if (checkboxEl) checkboxEl.checked = !isChecked;
    }
}

function exportToExcel(data, category) {
    if (!data || data.length === 0) {
        showToast("No hay datos para exportar", "warning");
        return;
    }

    // Definir columnas para la exportación
    const headers = [
        "Placa", "Marca", "CLASE VH", "Modelo", "Propietario/NIT", "Categoría", "Sede",
        "SOAT Expedición", "SOAT Vencimiento", "SOAT Estado",
        "RTM Expedición", "RTM Vencimiento", "RTM Estado",
        "Fumigación Expedición", "Fumigación Vencimiento",
        "Sanidad Expedición", "Sanidad Vencimiento",
        "VIN", "Motor", "Línea", "Color", "Combustible", "Cilindraje", "Carga KG", "Pasajeros", "Ejes",
        "Peso Bruto", "Nro Chasis", "Nro Serie", "Carrocería", "Servicio", "Clase Vehículo", "Puertas",
        "Nro Licencia", "Estado RUNT", "Fecha Matrícula", "Repotenciado", "Gravámenes", "Estado Sistema"
    ];

    // Mapear filas
    const rows = data.map(vh => {
        const row = [
            vh.placa, vh.marca, vh.clase_vehiculo || vh.clase || "--", vh.modelo, vh.nit_cedula || vh.propietario, vh.categoria, vh.sede,
            vh.soat_expedicion, vh.soat_vencimiento, vh.soat_estado,
            vh.rtm_expedicion, vh.rtm_vencimiento, vh.rtm_estado
        ];

        if (category !== 'CORP') {
            row.push(
                vh.fumigacion_expedicion, vh.fumigacion_vencimiento,
                vh.sanidad_expedicion, vh.sanidad_vencimiento
            );
        }

        row.push(
            vh.vin, vh.motor || vh.numero_motor, vh.linea, vh.color, vh.combustible, vh.cilindraje, vh.capacidad_carga, vh.capacidad_pasajeros, vh.ejes,
            vh.peso_bruto, vh.numero_chasis, vh.numero_serie, vh.tipo_carroceria, vh.tipo_servicio, vh.clase, vh.numero_puertas,
            vh.nro_licencia_transito, vh.estado_runt, vh.fecha_matricula, vh.repotenciado, vh.tiene_gravamenes, vh.estado
        );
        return row;
    });

    const finalHeaders = [...headers];
    if (category === 'CORP') {
        // Eliminar headers de fumigación y sanidad (índices 13, 14, 15, 16)
        finalHeaders.splice(13, 4);
    }

    // Generar CSV
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF"; // BOM para Excel UTF-8
    csvContent += finalHeaders.join(";") + "\n";
    rows.forEach(rowArray => {
        let row = rowArray.map(val => `"${(val || "").toString().replace(/"/g, '""')}"`).join(";");
        csvContent += row + "\n";
    });

    // Descargar
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Reporte_Flota_${category}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Exportando reporte a Excel (CSV)...", "success");
}

function exportFleetDataToCSV() {
    const data = window.allFleetData || [];
    const category = window.currentFleetCategory || 'GENERAL';
    exportToExcel(data, category);
}

function exportDriversDataToCSV() {
    const data = window.allDriversData || [];
    const category = window.currentDriverCategory || 'GENERAL';

    if (!data || data.length === 0) {
        showToast("No hay datos para exportar", "warning");
        return;
    }

    // Definir columnas para conductores
    const isPropia = category === 'PROPIA';
    const headers = [
        "Cédula", "Nombre Completo", "Sede", "Empresa/Categoría",
        "Licencia Categoría", "Licencia Expedición", "Licencia Vencimiento", "Licencia Días", "Licencia Estado",
        "Alimentos Documento", "Alimentos Expedición", "Alimentos Vencimiento", "Alimentos Días", "Alimentos Estado",
        "Curso SAS Documento", "Curso SAS Expedición", "Curso SAS Vencimiento", "Curso SAS Días", "Curso SAS Estado",
        "Multas", "Estado Conductor"
    ];

    // Mapear filas
    const rows = data.map(d => [
        d.cedula, d.nombre_completo, d.sede_id, d.categoria_empresa,
        d.licencia_categoria, d.licencia_expedicion, d.licencia_vencimiento, d.licencia_dias, d.licencia_estado,
        d.alimentos_documento, d.alimentos_expedicion, d.alimentos_vencimiento, d.alimentos_dias, d.alimentos_estado,
        d.sas_documento, d.sas_expedicion, d.sas_vencimiento, d.sas_dias, d.sas_estado,
        d.tiene_multas ? 'SI' : 'NO', d.estado_conductor
    ]);

    // Generar CSV
    let csvContent = "data:text/csv;charset=utf-8,\uFEFF";
    csvContent += headers.join(";") + "\n";
    rows.forEach(rowArray => {
        let row = rowArray.map(val => `"${(val || "").toString().replace(/"/g, '""')}"`).join(";");
        csvContent += row + "\n";
    });

    // Descargar
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Reporte_Conductores_${category}_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast("Exportando reporte de conductores a Excel...", "success");
}
