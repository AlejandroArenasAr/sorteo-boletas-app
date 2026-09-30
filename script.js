// ==========================================
// CONFIGURACIÓN PRINCIPAL
// ==========================================
const VALOR_BOLETA = 100000; // $100.000 COP
const MAX_BOLETAS = 9999;
const MAX_BOLETAS_EN_MODAL = 20; // Si un registro genera más, no se listan (se desborda): se remite a la base de datos
const TAMANO_LOTE = 50; // Clientes por petición al Apps Script en la carga masiva

// FECHA PARA ACTIVAR EL SORTEO (Año, Mes (0-11), Día, Hora, Minuto)
const FECHA_SORTEO = new Date(2026, 9, 31, 20, 0, 0); 

// TU URL DE GOOGLE APPS SCRIPT
const URL_GOOGLE_SCRIPT = "https://script.google.com/macros/s/AKfycbyACf1FuT3WWD4wllfIo-g6ZyNHy3Uaqk3U4y_OuDRXQO7E9gi8arY0XJXmYafRKyEoBA/exec"; 

// ==========================================
// ESTADO DE LA APLICACIÓN (Ahora es global)
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
// INTERFAZ Y EVENTOS
// ==========================================
document.addEventListener('DOMContentLoaded', () => {
    // Primera carga de datos desde el servidor
    consultarDatosGlobales();
    
    document.getElementById('fecha-sorteo-text').innerText = FECHA_SORTEO.toLocaleString('es-CO');
    document.getElementById('btn-add-factura').addEventListener('click', agregarFilaFactura);
    document.getElementById('lista-facturas').addEventListener('input', calcularTotales);
    document.getElementById('registro-form').addEventListener('submit', procesarRegistro);
    document.getElementById('btn-sortear').addEventListener('click', realizarSorteo);
    document.getElementById('archivo-masivo').addEventListener('change', leerArchivoMasivo);
    document.getElementById('btn-cargar-masivo').addEventListener('click', procesarCargaMasiva);
    document.getElementById('btn-detener-masivo').addEventListener('click', detenerCargaMasiva);

    // Validar botón de sorteo cada segundo
    setInterval(validarFechaSorteo, 1000);
    
    // Sincronizar datos con el servidor cada 15 segundos para ver lo que hacen otros asesores
    setInterval(consultarDatosGlobales, 15000);
});

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
        // Enviar datos a Google Sheets para que genere los números seguros
        const respuesta = await fetch(URL_GOOGLE_SCRIPT, {
            method: 'POST',
            body: JSON.stringify(nuevoCliente),
            headers: { 'Content-Type': 'text/plain;charset=utf-8' }
        });
        
        const resultado = await respuesta.json();

        if (resultado.estado === "exito") {
            // Mostrar modal con los números que Google Sheets asignó
            mostrarModalExito(resultado.boletas);
            
            // Refrescar los totales en pantalla
            consultarDatosGlobales();

            // Limpiar formulario
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

// Consulta a Google Drive los totales acumulados de todos los asesores
async function consultarDatosGlobales() {
    if (!URL_GOOGLE_SCRIPT) return;
    try {
        const res = await fetch(URL_GOOGLE_SCRIPT);
        const data = await res.json();
        
        // Actualizamos estado global
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
// CARGA MASIVA DESDE EXCEL
// ==========================================
// Cada fila del Excel es una factura. Las filas con el mismo teléfono se agrupan
// en un solo cliente y se envían a Google Sheets en lotes; el servidor valida y
// asigna los números de cada cliente con las mismas reglas del registro manual.
let cargaMasiva = {
    clientes: [],
    resultados: [],
    detener: false
};

// Cómo reconocer cada columna a partir del encabezado (sin tildes, en minúscula)
const COLUMNAS_MASIVO = {
    nombre: h => h.includes('nombre'),
    telefono: h => h.includes('telefono') || h.includes('celular'),
    factura: h => h.includes('factura'),
    monto: h => h.includes('monto') || h.includes('valor')
};

function normalizarTexto(valor) {
    return String(valor).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}

// Acepta 150000, "150000", "$150.000" o "1,250,000"
function leerMonto(valor) {
    if (typeof valor === 'number') return valor;
    let texto = String(valor).replace(/[$\s]/g, '');
    if (/^\d{1,3}([.,]\d{3})+$/.test(texto)) {
        texto = texto.replace(/[.,]/g, '');
    } else {
        texto = texto.replace(',', '.');
    }
    const monto = Number(texto);
    return isNaN(monto) ? 0 : monto;
}

async function leerArchivoMasivo(e) {
    const archivo = e.target.files[0];
    cargaMasiva.clientes = [];
    document.getElementById('masivo-resumen').classList.add('hidden');
    document.getElementById('masivo-final').classList.add('hidden');
    document.getElementById('masivo-no-registrados').classList.add('hidden');
    document.getElementById('btn-cargar-masivo').disabled = true;
    document.getElementById('archivo-nombre').innerText = archivo ? archivo.name : 'Seleccionar archivo…';
    if (!archivo) return;

    if (typeof XLSX === 'undefined') {
        alert("No se pudo cargar el lector de Excel. Revisa tu conexión a internet y recarga la página.");
        return;
    }

    try {
        const libro = XLSX.read(await archivo.arrayBuffer(), { type: 'array' });
        const hoja = libro.Sheets['Registros'] || libro.Sheets[libro.SheetNames[0]];
        // range: 0 + blankrows: true → el índice de cada fila coincide con su número en Excel (índice + 1)
        const filas = XLSX.utils.sheet_to_json(hoja, { header: 1, defval: '', blankrows: true, range: 0 });
        const { clientes, errores } = validarFilasMasivas(filas);
        cargaMasiva.clientes = clientes;
        mostrarResumenMasivo(clientes, errores);
    } catch (error) {
        alert("No se pudo leer el archivo: " + error.message);
        console.error(error);
    }
}

function validarFilasMasivas(filas) {
    const idxEncabezado = filas.findIndex(fila => {
        const celdas = fila.map(normalizarTexto);
        return celdas.some(COLUMNAS_MASIVO.nombre) && celdas.some(COLUMNAS_MASIVO.monto);
    });
    if (idxEncabezado === -1) {
        throw new Error('no se encontraron los encabezados "Nombre del cliente", "Teléfono", "ID Factura" y "Monto". Usa la plantilla descargable.');
    }

    const encabezados = filas[idxEncabezado].map(normalizarTexto);
    const col = {};
    for (const [campo, coincide] of Object.entries(COLUMNAS_MASIVO)) {
        col[campo] = encabezados.findIndex(coincide);
        if (col[campo] === -1) throw new Error(`falta la columna "${campo}". Usa la plantilla descargable.`);
    }

    const errores = [];
    const clientesPorTelefono = new Map();
    const facturasVistas = new Map(); // ID factura → { fila, telefono }
    const telefonosConError = new Set();

    for (let i = idxEncabezado + 1; i < filas.length; i++) {
        const fila = filas[i];
        const numFila = i + 1;
        const celda = campo => String(fila[col[campo]] ?? '').trim();
        const nombre = celda('nombre');
        const telefono = celda('telefono');
        const idFactura = celda('factura');
        const montoCrudo = celda('monto');

        if (!nombre && !telefono && !idFactura && !montoCrudo) continue; // fila vacía

        const monto = leerMonto(fila[col.monto] ?? '');
        const telDigitos = telefono.replace(/\D/g, '');
        const claveFactura = idFactura.toUpperCase();
        const problemas = [];

        if (!nombre) problemas.push('falta el nombre');
        if (!telDigitos) problemas.push('falta el teléfono');
        if (!idFactura) problemas.push('falta el ID de factura');
        if (!(monto > 0)) problemas.push('monto inválido');
        if (idFactura && facturasVistas.has(claveFactura)) {
            const original = facturasVistas.get(claveFactura);
            problemas.push(`factura ${idFactura} repetida (también en la fila ${original.fila})`);
            telefonosConError.add(original.telefono);
        }

        const cliente = clientesPorTelefono.get(telDigitos);
        if (cliente && nombre && normalizarTexto(cliente.nombre) !== normalizarTexto(nombre)) {
            problemas.push(`el teléfono ${telefono} ya aparece con el nombre "${cliente.nombre}"`);
        }

        if (problemas.length) {
            errores.push({ filas: [numFila], motivo: problemas.join('; ') });
            if (telDigitos) telefonosConError.add(telDigitos);
            continue;
        }

        facturasVistas.set(claveFactura, { fila: numFila, telefono: telDigitos });
        if (!cliente) {
            clientesPorTelefono.set(telDigitos, { nombre, telefono, facturas: [], totalComprado: 0, filas: [] });
        }
        const c = clientesPorTelefono.get(telDigitos);
        c.facturas.push({ id: idFactura, monto });
        c.totalComprado += monto;
        c.filas.push(numFila);
    }

    // Mismas reglas del registro manual: un cliente con filas erróneas no se registra a medias,
    // y el total debe alcanzar al menos una boleta.
    const clientes = [];
    for (const [tel, c] of clientesPorTelefono) {
        if (telefonosConError.has(tel)) {
            errores.push({ filas: c.filas, motivo: `${c.nombre}: no se registra hasta corregir los errores relacionados (otras filas del mismo teléfono o factura repetida)` });
            continue;
        }
        const boletas = Math.floor(c.totalComprado / VALOR_BOLETA);
        if (boletas < 1) {
            errores.push({ filas: c.filas, motivo: `${c.nombre}: total de ${formatoPesos(c.totalComprado)} es inferior a ${formatoPesos(VALOR_BOLETA)}` });
            continue;
        }
        clientes.push({ ...c, boletas });
    }

    errores.sort((a, b) => a.filas[0] - b.filas[0]);
    return { clientes, errores };
}

function mostrarResumenMasivo(clientes, errores) {
    const totalFacturas = clientes.reduce((s, c) => s + c.facturas.length, 0);
    const totalBoletas = clientes.reduce((s, c) => s + c.boletas, 0);
    const totalVentas = clientes.reduce((s, c) => s + c.totalComprado, 0);
    const disponibles = MAX_BOLETAS - db.estadisticas.totalBoletas;

    document.getElementById('res-clientes').innerText = clientes.length;
    document.getElementById('res-facturas').innerText = totalFacturas;
    document.getElementById('res-boletas').innerText = totalBoletas;
    document.getElementById('res-total').innerText = formatoPesos(totalVentas);

    const cajaErrores = document.getElementById('masivo-errores');
    cajaErrores.innerHTML = '';
    const avisos = [];

    if (clientes.length === 0 && errores.length === 0) {
        avisos.push('El archivo no tiene registros diligenciados en la hoja "Registros".');
    }
    if (totalBoletas > disponibles) {
        avisos.push(`El archivo generaría ${totalBoletas} boletas, pero solo quedan ${disponibles} disponibles de ${MAX_BOLETAS}. Divide el archivo o revisa los montos.`);
    }

    avisos.forEach(texto => {
        const p = document.createElement('p');
        p.className = 'error-msg';
        p.innerText = texto;
        cajaErrores.appendChild(p);
    });

    if (errores.length) {
        const titulo = document.createElement('strong');
        titulo.innerText = `${errores.length} problema(s) encontrados — estas filas NO se registrarán:`;
        cajaErrores.appendChild(titulo);

        const lista = document.createElement('ul');
        const MAX_ERRORES_VISIBLES = 100;
        errores.slice(0, MAX_ERRORES_VISIBLES).forEach(err => {
            const li = document.createElement('li');
            const filaTxt = document.createElement('span');
            filaTxt.className = 'err-fila';
            filaTxt.innerText = err.filas.length > 1 ? `Filas ${err.filas.join(', ')}` : `Fila ${err.filas[0]}`;
            li.appendChild(filaTxt);
            li.appendChild(document.createTextNode(' ' + err.motivo));
            lista.appendChild(li);
        });
        if (errores.length > MAX_ERRORES_VISIBLES) {
            const li = document.createElement('li');
            li.innerText = `… y ${errores.length - MAX_ERRORES_VISIBLES} más. Corrige los primeros y vuelve a subir el archivo.`;
            lista.appendChild(li);
        }
        cajaErrores.appendChild(lista);
    }

    cajaErrores.classList.toggle('hidden', cajaErrores.childElementCount === 0);
    document.getElementById('masivo-resumen').classList.remove('hidden');

    const btnCargar = document.getElementById('btn-cargar-masivo');
    btnCargar.disabled = clientes.length === 0 || totalBoletas > disponibles;
    btnCargar.innerText = clientes.length
        ? `Registrar ${clientes.length} cliente(s) y generar ${totalBoletas} boleta(s)`
        : 'Registrar clientes del archivo';
}

function avisarSalidaDuranteCarga(e) {
    e.preventDefault();
    e.returnValue = '';
}

function detenerCargaMasiva() {
    cargaMasiva.detener = true;
    const btn = document.getElementById('btn-detener-masivo');
    btn.disabled = true;
    btn.innerText = 'Deteniendo…';
}

function actualizarProgreso(hechos, total, texto) {
    document.getElementById('barra-relleno').style.width = `${Math.round((hechos / total) * 100)}%`;
    document.getElementById('progreso-texto').innerText = texto;
}

async function procesarCargaMasiva() {
    const clientes = cargaMasiva.clientes;
    if (clientes.length === 0) return;

    const totalBoletas = clientes.reduce((s, c) => s + c.boletas, 0);
    if (!confirm(`Se registrarán ${clientes.length} cliente(s) y se generarán ${totalBoletas} boleta(s) en la base de datos. ¿Continuar?`)) return;

    const btnCargar = document.getElementById('btn-cargar-masivo');
    const btnDetener = document.getElementById('btn-detener-masivo');
    const inputArchivo = document.getElementById('archivo-masivo');

    cargaMasiva.detener = false;
    cargaMasiva.resultados = clientes.map(c => ({
        nombre: c.nombre,
        telefono: c.telefono,
        estado: 'No procesado',
        detalle: '',
        boletas: 0
    }));
    btnCargar.disabled = true;
    btnCargar.innerText = "Registrando en la nube... ⏳";
    inputArchivo.disabled = true;
    btnDetener.disabled = false;
    btnDetener.innerText = 'Detener después del lote actual';
    btnDetener.classList.remove('hidden');
    document.getElementById('masivo-progreso').classList.remove('hidden');
    window.addEventListener('beforeunload', avisarSalidaDuranteCarga);

    let fallosConexionSeguidos = 0;
    let motivoDetencion = '';

    for (let inicio = 0; inicio < clientes.length; inicio += TAMANO_LOTE) {
        if (cargaMasiva.detener || motivoDetencion) break;

        const lote = clientes.slice(inicio, inicio + TAMANO_LOTE);
        const resultadosLote = cargaMasiva.resultados.slice(inicio, inicio + TAMANO_LOTE);
        actualizarProgreso(inicio, clientes.length, `Registrando clientes ${inicio + 1} a ${inicio + lote.length} de ${clientes.length}…`);

        try {
            // Un solo POST por lote; Google Sheets valida y asigna los números de cada cliente
            const respuesta = await fetch(URL_GOOGLE_SCRIPT, {
                method: 'POST',
                body: JSON.stringify({
                    accion: 'lote',
                    clientes: lote.map(c => ({
                        nombre: c.nombre,
                        telefono: c.telefono,
                        facturas: c.facturas,
                        totalComprado: c.totalComprado
                    }))
                }),
                headers: { 'Content-Type': 'text/plain;charset=utf-8' }
            });
            const data = await respuesta.json();
            fallosConexionSeguidos = 0;

            if (Array.isArray(data.resultados)) {
                data.resultados.forEach((r, j) => {
                    if (r.estado === "exito") {
                        resultadosLote[j].estado = 'Registrado';
                        resultadosLote[j].boletas = (r.boletas || []).length;
                    } else {
                        resultadosLote[j].estado = 'Rechazado';
                        resultadosLote[j].detalle = r.mensaje || 'El servidor no aceptó el registro.';
                    }
                });
            } else {
                // El servidor rechazó el lote completo (no guardó nada): se detiene para no repetir el error
                const mensaje = data.mensaje || 'El servidor no aceptó el lote.';
                resultadosLote.forEach(r => { r.estado = 'Rechazado'; r.detalle = mensaje; });
                motivoDetencion = `El servidor rechazó la carga: ${mensaje}\nSi el error persiste, verifica que el Apps Script esté actualizado con la carga por lotes y publicado como nueva versión.`;
            }
        } catch (error) {
            console.error(error);
            fallosConexionSeguidos++;
            // No se reintenta solo. Al volver a cargar el archivo, las facturas que sí alcanzaron
            // a guardarse se rechazan como repetidas, así que no se duplican clientes.
            resultadosLote.forEach(r => {
                r.estado = 'Sin confirmar';
                r.detalle = 'Error de conexión: no se sabe si quedó registrado. Vuelve a cargarlo; si ya estaba, se rechazará como factura repetida.';
            });
            if (fallosConexionSeguidos >= 3) motivoDetencion = 'Se detuvo por errores de conexión repetidos.';
        }
    }

    cargaMasiva.resultados
        .filter(r => r.estado === 'No procesado')
        .forEach(r => r.detalle = 'La carga se detuvo antes de llegar a este cliente.');

    actualizarProgreso(clientes.length, clientes.length, 'Carga finalizada.');
    window.removeEventListener('beforeunload', avisarSalidaDuranteCarga);
    btnDetener.classList.add('hidden');
    inputArchivo.disabled = false;

    // Se limpia el archivo para evitar registrar dos veces los mismos clientes
    cargaMasiva.clientes = [];
    inputArchivo.value = '';
    document.getElementById('archivo-nombre').innerText = 'Seleccionar archivo…';
    document.getElementById('masivo-resumen').classList.add('hidden');
    document.getElementById('masivo-progreso').classList.add('hidden');
    btnCargar.innerText = 'Registrar clientes del archivo';
    btnCargar.disabled = true;

    consultarDatosGlobales();
    mostrarResultadoMasivo(motivoDetencion);
}

function mostrarResultadoMasivo(motivoDetencion) {
    const resultados = cargaMasiva.resultados;
    const registrados = resultados.filter(r => r.estado === 'Registrado');
    const noRegistrados = resultados.filter(r => r.estado !== 'Registrado');
    const boletasAsignadas = registrados.reduce((s, r) => s + r.boletas, 0);

    let titulo = '¡Carga masiva completada!';
    if (motivoDetencion || cargaMasiva.detener) titulo = 'Carga masiva detenida';

    let texto = `Se registraron ${registrados.length} de ${resultados.length} cliente(s) y se asignaron ${boletasAsignadas} boleta(s). Números asignados: revisa la base de datos.`;
    if (motivoDetencion) texto = `${motivoDetencion}\n\n${texto}`;
    if (noRegistrados.length > 0) {
        texto += `\n\n${noRegistrados.length} cliente(s) no quedaron registrados. El detalle aparece en la sección "Carga masiva".`;
    }

    document.getElementById('masivo-final-texto').innerText = `Última carga: ${registrados.length} de ${resultados.length} cliente(s) registrados, ${boletasAsignadas} boleta(s) asignadas. Números asignados: revisa la base de datos.`;
    document.getElementById('masivo-final').classList.remove('hidden');
    mostrarNoRegistrados(noRegistrados);

    abrirModal(titulo, texto);
}

// Lista en pantalla de los clientes que no quedaron registrados y el motivo
function mostrarNoRegistrados(noRegistrados) {
    const caja = document.getElementById('masivo-no-registrados');
    caja.innerHTML = '';
    caja.classList.toggle('hidden', noRegistrados.length === 0);
    if (noRegistrados.length === 0) return;

    const titulo = document.createElement('strong');
    titulo.innerText = `${noRegistrados.length} cliente(s) no registrados — corrígelos y súbelos en un archivo nuevo:`;
    caja.appendChild(titulo);

    const lista = document.createElement('ul');
    const MAX_VISIBLES = 100;
    noRegistrados.slice(0, MAX_VISIBLES).forEach(r => {
        const li = document.createElement('li');
        const cliente = document.createElement('span');
        cliente.className = 'err-fila';
        cliente.innerText = `${r.nombre} (${r.telefono})`;
        li.appendChild(cliente);
        li.appendChild(document.createTextNode(' ' + r.detalle));
        lista.appendChild(li);
    });
    if (noRegistrados.length > MAX_VISIBLES) {
        const li = document.createElement('li');
        li.innerText = `… y ${noRegistrados.length - MAX_VISIBLES} más.`;
        lista.appendChild(li);
    }
    caja.appendChild(lista);
}

// ==========================================
// MODAL Y UTILIDADES
// ==========================================
function abrirModal(titulo, texto) {
    document.getElementById('modal-titulo').innerText = titulo;
    document.getElementById('modal-texto').innerText = texto;
    document.getElementById('modal-boletas').innerHTML = '';
    document.getElementById('modal-exito').classList.remove('hidden');
}

function mostrarModalExito(numeros) {
    if (numeros.length > MAX_BOLETAS_EN_MODAL) {
        abrirModal('¡Registro Exitoso!', `Se generaron ${numeros.length} boletas para el cliente. Números asignados: revisa la base de datos.`);
        return;
    }

    abrirModal('¡Registro Exitoso!', 'Se han generado las siguientes boletas para el cliente:');
    const contenedorBoletas = document.getElementById('modal-boletas');
    numeros.forEach(num => {
        const span = document.createElement('span');
        span.className = 'boleta-item';
        span.innerText = `#${num.toString().padStart(4, '0')}`;
        contenedorBoletas.appendChild(span);
    });
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
