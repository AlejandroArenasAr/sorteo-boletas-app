// ==========================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================
const CLAVE_HASH = "dca73d014f885149c5c4ed29b002ad5357df21d168137214b3c7bc8eb3897bd1";
const VALOR_BOLETA = 100000; 
const MAX_BOLETAS = 9999;

// FECHA PARA ACTIVAR EL SORTEO (Año, Mes (0-11), Día, Hora, Minuto)
const FECHA_SORTEO = new Date(2026, 9, 31, 20, 0, 0); 

// TU URL DE GOOGLE APPS SCRIPT
const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbxY4C5AgjQ2tlhFK4cNaRGBiTjazYlbnj_Qum2Uwqx4R_UyNgJtu1QZEj2m4CjtBSEc/exec"; 

// ==========================================
// ESTADO DE LA APLICACIÓN
// ==========================================
let db = {
    boletasAsignadas: [],
    estadisticas: {
        totalClientes: 0,
        totalBoletas: 0,
        totalVentas: 0
    }
};

// ==========================================
// INTERFAZ, SEGURIDAD Y EVENTOS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // 1. Evento para el formulario de Login
    document.getElementById('login-form').addEventListener('submit', verificarClave);

    // 2. Comprobar si ya ingresó la contraseña anteriormente en esta sesión
    if (sessionStorage.getItem('acceso_concedido') === 'true') {
        desbloquearPantalla();
    }

    document.getElementById('fecha-sorteo-text').innerText = FECHA_SORTEO.toLocaleString('es-CO');
    document.getElementById('btn-add-factura').addEventListener('click', agregarFilaFactura);
    document.getElementById('lista-facturas').addEventListener('input', calcularTotales);
    document.getElementById('registro-form').addEventListener('submit', procesarRegistro);
    document.getElementById('btn-sortear').addEventListener('click', realizarSorteo);
    
    setInterval(validarFechaSorteo, 1000);
    setInterval(consultarDatosGlobales, 15000);
});

async function generarHash(texto) {
    const buffer = new TextEncoder().encode(texto);
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Lógica de Validación de Contraseña
function verificarClave(e) {
    e.preventDefault();
    const claveIngresada = document.getElementById('access-key').value.trim();
    const errorMsg = document.getElementById('login-error');

const hashIngresado = await generarHash(claveIngresada);

    if (hashIngresado === CLAVE_HASH) {
        sessionStorage.setItem('acceso_concedido', 'true');
        desbloquearPantalla();
    } else {
        errorMsg.classList.remove('hidden');
        document.getElementById('access-key').value = '';
    }
}

function desbloquearPantalla() {
    const loginScreen = document.getElementById('login-screen');
    const appContent = document.getElementById('app-content');

    // Ocultar pantalla de login
    loginScreen.classList.add('hidden');
    loginScreen.style.display = 'none';

    // Mostrar aplicación principal
    appContent.classList.remove('hidden');
    appContent.style.display = 'block';

    // Cargar datos globales desde Google Sheets
    consultarDatosGlobales();
}

function agregarFilaFactura() {
    const container = document.getElementById('lista-facturas');
    const div = document.createElement('div');
    div.className = 'factura-row';
    div.innerHTML = `
        <input type="text" class="factura-id" placeholder="ID Factura" required>
        <input type="number" class="factura-monto" placeholder="Monto ($)" min="0" required>
        <button type="button" class="btn-remove" onclick="eliminarFilaFactura(this)">X</button>
    `;
    container.appendChild(div);
    actualizarBotonesEliminar();
}

function eliminarFilaFactura(btn) {
    btn.parentElement.remove();
    actualizarBotonesEliminar();
    calcularTotales();
}

function actualizarBotonesEliminar() {
    const botones = document.querySelectorAll('.btn-remove');
    botones.forEach(btn => btn.disabled = botones.length === 1);
}

function calcularTotales() {
    const montos = document.querySelectorAll('.factura-monto');
    let total = 0;
    
    montos.forEach(input => {
        const valor = parseFloat(input.value) || 0;
        total += valor;
    });

    const cantidadBoletas = Math.floor(total / VALOR_BOLETA);

    document.getElementById('preview-total').innerText = formatoPesos(total);
    document.getElementById('preview-boletas').innerText = `${cantidadBoletas} boleta(s)`;

    const btnSubmit = document.getElementById('btn-submit');
    const errorMonto = document.getElementById('error-monto');
    
    if (total > 0 && total < VALOR_BOLETA) {
        if(errorMonto) errorMonto.classList.remove('hidden');
        btnSubmit.disabled = true;
    } else {
        if(errorMonto) errorMonto.classList.add('hidden');
        btnSubmit.disabled = cantidadBoletas < 1;
    }
}

// ==========================================
// LÓGICA CORE: CONEXIÓN CON GOOGLE SHEETS
// ==========================================
async function procesarRegistro(e) {
    e.preventDefault();

    const nombre = document.getElementById('cliente-nombre').value.trim();
    const telefono = document.getElementById('cliente-telefono').value.trim();
    
    const facturas = [];
    let totalComprado = 0;
    const filasFacturas = document.querySelectorAll('.factura-row');
    
    filasFacturas.forEach(fila => {
        const id = fila.querySelector('.factura-id').value.trim();
        const monto = parseFloat(fila.querySelector('.factura-monto').value) || 0;
        if(id && monto > 0) {
            facturas.push({ id, monto });
            totalComprado += monto;
        }
    });

    const cantidadBoletas = Math.floor(totalComprado / VALOR_BOLETA);
    if (cantidadBoletas < 1) return;

    const btnSubmit = document.getElementById('btn-submit');
    btnSubmit.disabled = true;
    btnSubmit.innerText = "Registrando en la nube... ⏳";

    const nuevoCliente = {
        nombre,
        telefono,
        facturas,
        totalComprado
    };

    try {
        const respuesta = await fetch(URL_GOOGLE_SCRIPT, {
            method: 'POST',
            body: JSON.stringify(nuevoCliente),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        
        const resultado = await respuesta.json();

        if (resultado.estado === "exito") {
            mostrarModalExito(resultado.boletas);
            consultarDatosGlobales();

            e.target.reset();
            document.getElementById('lista-facturas').innerHTML = `
                <div class="factura-row">
                    <input type="text" class="factura-id" placeholder="ID Factura" required>
                    <input type="number" class="factura-monto" placeholder="Monto ($)" min="0" required>
                    <button type="button" class="btn-remove" disabled>X</button>
                </div>
            `;
        } else {
            alert("Error: " + resultado.mensaje);
        }
    } catch (error) {
        alert("Ocurrió un error al conectar con Google Drive. Por favor, reintenta.");
        console.error(error);
    } finally {
        btnSubmit.innerText = "Registrar y generar boletas";
        calcularTotales();
    }
}

async function consultarDatosGlobales() {
    if (!URL_GOOGLE_SCRIPT) return;
    try {
        const res = await fetch(URL_GOOGLE_SCRIPT);
        const data = await res.json();
        
        db.estadisticas.totalClientes = data.totalClientes;
        db.estadisticas.totalBoletas = data.totalBoletas;
        db.estadisticas.totalVentas = data.totalVentas;
        db.boletasAsignadas = data.boletasAsignadas;

        actualizarDashboard();
    } catch (e) {
        console.error("Error sincronizando con la base de datos", e);
    }
}

// ==========================================
// MODAL Y UTILIDADES
// ==========================================
function mostrarModalExito(numeros) {
    const contenedorBoletas = document.getElementById('modal-boletas');
    contenedorBoletas.innerHTML = ''; 
    
    numeros.forEach(num => {
        const span = document.createElement('span');
        span.className = 'boleta-item';
        span.innerText = `#${num.toString().padStart(4, '0')}`;
        contenedorBoletas.appendChild(span);
    });
    
    document.getElementById('modal-exito').classList.remove('hidden');
}

function cerrarModal() {
    document.getElementById('modal-exito').classList.add('hidden');
}

function formatoPesos(valor) {
    return new Intl.NumberFormat('es-CO', {
        style: 'currency',
        currency: 'COP',
        minimumFractionDigits: 0
    }).format(valor);
}

// ==========================================
// SORTEO Y DASHBOARD
// ==========================================
function actualizarDashboard() {
    document.getElementById('stat-clients').innerText = db.estadisticas.totalClientes;
    document.getElementById('stat-tickets').innerText = db.estadisticas.totalBoletas;
    document.getElementById('stat-sales').innerText = formatoPesos(db.estadisticas.totalVentas);
}

function validarFechaSorteo() {
    const btnSortear = document.getElementById('btn-sortear');
    const statusText = document.getElementById('sorteo-status');
    const ahora = new Date();

    if (ahora >= FECHA_SORTEO) {
        btnSortear.disabled = false;
        statusText.innerText = "¡El sorteo está habilitado!";
        statusText.style.color = "var(--accent-color)";
    } else {
        btnSortear.disabled = true;
    }
}

function realizarSorteo() {
    if (db.boletasAsignadas.length === 0) {
        alert("No hay boletas asignadas para realizar el sorteo.");
        return;
    }

    const indiceGanador = Math.floor(Math.random() * db.boletasAsignadas.length);
    const numeroGanador = db.boletasAsignadas[indiceGanador];

    const cajaResultado = document.getElementById('ganador-resultado');
    const infoSorteo = document.getElementById('ganador-info');
    
    infoSorteo.innerHTML = `
        <strong>¡Tenemos un número ganador!</strong><br><br>
        <span style="font-size: 24px; color: var(--accent-color);">Boleto #${numeroGanador.toString().padStart(4, '0')}</span><br><br>
        <em>Por favor, revisa el archivo de Google Sheets para confirmar el nombre y teléfono del cliente ganador.</em>
    `;
    cajaResultado.classList.remove('hidden');
}
