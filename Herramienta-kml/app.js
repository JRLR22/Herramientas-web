// =======================
// JS Base: Vista Previa Múltiple + Control de Puntos
// =======================
//
// Este archivo implementa un visor Leaflet con soporte para:
// - Lectura de coordenadas en texto o CSV
// - Visualización con estilos y patrones SVG
// - Exportación a KML y CSV
// - Medición de áreas y longitudes

// Inicializa el mapa centrado en México con la capa base de Esri satélite.
// Se agregan también otras capas opcionales (callejero, oscuro, topográfico).

// Mapa base satélite de ESRI
const esriSat = L.esri.basemapLayer("Imagery");

// Mapa base oscuro (CartoDB)
const capaOscura = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a>',
});

// Mapa base de calles (OpenStreetMap)
const openStreet = L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  attribution: "© OpenStreetMap contributors"
});

// Mapa base topográfico de ESRI
const esriTopo = L.esri.basemapLayer("Topographic");

// Crear el mapa Leaflet centrado en México con zoom inicial y capa base satélite

const map = L.map("map", {
  center: [23.6345, -102.5528],
  zoom: 5,
  layers: [esriSat],
});

// Cada que el usuario se mueva o haga zoom, recalcular la escala numérica en pantalla
map.on('move zoom', calcularEscalaNumerica);

// Al terminar de cargar el mapa (una sola vez), insertar patrones y calcular escala
map.whenReady(() => {
  calcularEscalaNumerica();
  insertarPatronesSVG();
});



// Selector de capas base para permitir al usuario cambiar entre mapas
const baseMaps = {
  "Satélite": esriSat,
  'Oscuro': capaOscura,
  "OpenStreetMap": openStreet,
  "Topográfico": esriTopo
};

// Agregar control visual al mapa (arriba a la derecha por defecto)
L.control.layers(baseMaps).addTo(map);

// Rosa de los vientos decorativa (esquina inferior derecha)
const rosaControl = L.control({ position: "bottomright" });
rosaControl.onAdd = function (map) {
  const img = L.DomUtil.create("img");
  img.src = "simple_wind_rose.svg"; // Asegúrate de que esta ruta sea correcta
  img.style.width = "80px";
  img.style.opacity = "0.8";
  img.style.pointerEvents = "none"; // Permite que no bloquee clics en el mapa
  return img;
};
rosaControl.addTo(map);

// Mostrar coordenadas UTM dinámicamente mientras se mueve el cursor en el mapa
map.on("mousemove", function (e) {
  const { lat, lng } = e.latlng;
  // Calcular zona UTM con fórmula estándar
  const zona = Math.floor((lng + 180) / 6) + 1;
  // Convertir LatLng a coordenadas UTM usando proj4
  const [x, y] = proj4(`+proj=utm +zone=${zona} +datum=WGS84`, [lng, lat]);
  // Mostrar resultado en el contenedor con id="utmCoords"
  document.getElementById("utmCoords").textContent = `UTM: X=${x.toFixed(2)} Y=${y.toFixed(2)} Zona=${zona}N`;
});


// ===========================
// VARIABLES GLOBALES
// ===========================

// Capas dibujadas actualmente en el mapa
let drawnLayers = [];
// Último patrón usado (para evitar repetir inmediatamente)
let ultimoPatronUsado = null;
// Último texto cargado desde un archivo KML
let ultimoKMLTexto = null;
// Referencias a tooltips activos
let tooltipRefs = [];
// Referencias a marcadores de vértices numerados (V1, V2, ...)
let vertexMarkers = [];
// Diccionario de tipos permitidos en texto plano
const tiposPermitidos = {
  "poligono": "Polygon",
  "polígono": "Polygon",
  "linea": "LineString",
  "línea": "LineString",
  "punto": "Point"
};
// Patrones disponibles para aplicar a polígonos
const patronesDisponibles = [
  "patron-diagonal",
  "patron-puntos",
  "patron-oscuro",
  "patron-vertical",
  "patron-horizontal",
  "patron-cuadros",
  "patron-cruz",
  "patron-diagonal-inversa",
  "patron-estrella",
  "patron-diagonal-fina"
];


/**
 -----Aquí procesa las coordenadas que escribimos-------
 * Procesa texto pegado desde el área de texto (formato tipo UTM).
 * Separa por bloques (cada uno inicia con un encabezado tipo: "Nombre zona=XX tipo=XX")
 * Convierte cada bloque en una geometría y la dibuja en el mapa con patrón SVG.
 */

function procesarTextoPlano(texto) {
  limpiarMapa();// Limpia capas y leyendas anteriores
  // Separar bloques de texto por "#"
  const bloques = texto.split("#").map(b => b.trim()).filter(Boolean);
  // Usado para ajustar el mapa al final
  let bounds = null;
  // Asignación de patrón por nombre de objeto (para mantener coherencia)
  const patronAsignadoPorNombre = {};
  const patrones = [
    "patron-diagonal",
    "patron-puntos",
    "patron-oscuro",
    "patron-vertical",
    "patron-horizontal",
    "patron-cruz",
    "patron-diagonal-inversa",
    "patron-estrella",
    "patron-diagonal-fina"
  ];

  // Limpiar lista de puntos lateral
  const listaSidebar = document.getElementById("lista-puntos");
  listaSidebar.innerHTML = "";

  for (const bloque of bloques) {
    // Separar líneas del bloque
    const lineas = bloque.split("\n").map(l => l.trim()).filter(Boolean);

    // Leer primera línea como encabezado y extraer nombre, zona, tipo
    const encabezado = lineas[0];
    const match = encabezado.match(/^(.+?)\s+zona=(\d+)\s+tipo=(.+)$/i);
    if (!match) {
      alert(`Encabezado mal formado: ${encabezado}`);
      return;
    }

    const nombre = match[1].trim();
    const zona = parseInt(match[2]);
    const tipoTexto = match[3].toLowerCase().normalize("NFD").replace(/\p{Diacritic}/gu, "");
    const tipo = tiposPermitidos[tipoTexto];

    if (!tipo) {
      alert(`Tipo no válido en: ${nombre}`);
      return;
    }

    const coords = [];

    for (let i = 1; i < lineas.length; i++) {
      const partes = lineas[i].trim().split(/\s+/);

      // Si viene índice al inicio de la línea, lo tomamos
      let indice = i;
      if (partes.length === 3 && /^\d+$/.test(partes[0])) {
        indice = partes[0];
      }

      // Parsear coordenadas
      const [x, y] = partes.length === 3 ? [partes[1], partes[2]] : partes;
      const fx = parseFloat(x.replace(",", "."));
      const fy = parseFloat(y.replace(",", "."));
      if (isNaN(fx) || isNaN(fy)) continue;

      // Convertir UTM → LatLng
      const [lng, lat] = proj4(`+proj=utm +zone=${zona} +datum=WGS84`, "WGS84", [fx, fy]);
      coords.push({ lat, lng, indice, utm: `${fx}, ${fy}` });
    }

    if (tipo === "Point") {
      // Crear marcador para cada punto
      for (const p of coords) {
        const marker = L.marker([p.lat, p.lng], { title: `${nombre} Punto ${p.indice}` })
          .addTo(map)
          .bindPopup(`<b>${nombre}</b><br>Punto ${p.indice}<br>UTM (${p.utm})`);

        drawnLayers.push(marker); // Guardamos para posibles exportaciones
      }
    } else {
      const latlngs = coords.map(p => [p.lat, p.lng]);
      let shape;

      // Asignar un patrón aleatorio distinto al anterior si aún no tiene uno
      if (!patronAsignadoPorNombre[nombre]) {
        let nuevoPatron;
        do {
          nuevoPatron = patrones[Math.floor(Math.random() * patrones.length)];
        } while (nuevoPatron === ultimoPatronUsado);

        patronAsignadoPorNombre[nombre] = nuevoPatron;
        ultimoPatronUsado = nuevoPatron;
      }

      const idPatron = patronAsignadoPorNombre[nombre]; // Este patrón se aplicará

      // 🎨 Obtener estilo seleccionado por el usuario ("blanco" o "aleatorio")
      const estilo = document.getElementById("estiloPoligono")?.value || "blanco";



      if (tipo === "Polygon") {
        // Inicializa patrón por nombre
        if (!patronAsignadoPorNombre[nombre]) {
          let nuevoPatron;
          do {
            nuevoPatron = patrones[Math.floor(Math.random() * patrones.length)];
          } while (nuevoPatron === ultimoPatronUsado);
          patronAsignadoPorNombre[nombre] = nuevoPatron;
          ultimoPatronUsado = nuevoPatron;
        }
        const idPatron = patronAsignadoPorNombre[nombre];


        const estilo = document.getElementById("estiloPoligono")?.value || "blanco";
        const colorContorno = estilo === "aleatorio" ? generarColor() : "#ffffff";



        // Capa base del polígono (relleno blanco + borde visible)
        shape = L.polygon(latlngs, {
          color: colorContorno,
          weight: 2,
          fillColor: colorContorno,
          fillOpacity: 0.6,
          className: `patron-${idPatron}` // Clase opcional para aplicar estilos CSS
        });

        // Capa superior con el patrón SVG (relleno transparente + patrón)
        const patron = L.polygon(latlngs, {
          color: 'transparent',
          weight: 0,
          fillColor: `url(#${idPatron})`, // 🔗 Patrón SVG aplicado aquí
          fillOpacity: 1,
          interactive: false  // No se puede hacer clic sobre esta capa
        }).addTo(map);
        patron._esPatronVisual = true; // Bandera para ignorar en exportaciones
        drawnLayers.push(patron);

        // Agregar polígono base (con borde y popup)
        shape.addTo(map).bindPopup(`<b>${nombre}</b>`);
        drawnLayers.push(shape);

        /// Crear entrada en la leyenda (cuadro con patrón + nombre + selector)
        const contenedorLeyenda = document.getElementById("leyendaContenido");
        if (contenedorLeyenda) {
          const item = document.createElement("div");
          item.className = "flex items-center mb-1";


          item.innerHTML = `
  <svg width="20" height="20" style="margin-right:8px; border:1px solid #ccc;" id="svg-${nombre}">
    <rect width="20" height="20" fill="${colorContorno}" />
    <rect id="rect-${nombre}" width="20" height="20" fill="url(#${idPatron})" />
  </svg>
  <span class="mr-2 text-xs">${nombre}</span>
  <select data-nombre="${nombre}" class="text-xs border rounded px-1 py-0.5">
    ${patronesDisponibles.map(p => `<option value="${p}" ${p === idPatron ? 'selected' : ''}>${p.replace('patron-', '')}</option>`).join("")}
  </select>
`;

          contenedorLeyenda.appendChild(item);

          const selector = item.querySelector("select");

          selector.addEventListener("change", e => {
            const nuevoPatron = e.target.value;
            const nombre = e.target.dataset.nombre;

            // Cambiar patrón visual en la leyenda
            const rect = document.getElementById(`rect-${nombre}`);
            if (rect) rect.setAttribute("fill", `url(#${nuevoPatron})`);

            // Cambiar patrón en la capa SVG del mapa
            map.eachLayer(layer => {
              if (layer._esPatronVisual && layer.getPopup && layer.getPopup().getContent().includes(`<b>${nombre}</b>`)) {
                layer.setStyle({ fillColor: `url(#${nuevoPatron})` });
              }
            });
          });
        }

      }
      else {
        // Dibujar línea (sin patrón)
        shape = L.polyline(latlngs, { color });
      }

      shape._vertexIndices = coords.map(p => p.indice);
      // Ajustar vista para mostrar todos los objetos cargados
      if (!bounds) bounds = shape.getBounds();
      else bounds.extend(shape.getBounds());


      coords.forEach((p, idx) => {
        // Marcador invisible (para poder enlazar el tooltip)
        const invisibleMarker = L.circleMarker([p.lat, p.lng], {
          radius: 0,
          opacity: 0,
          fillOpacity: 0
        }).addTo(map);
        // Tooltip emergente con nombre y número de vértice
        const tooltip = L.tooltip({
          permanent: false,
          direction: "top",
          className: "text-xs bg-white p-1 rounded shadow"
        })
          .setContent(`${nombre} - Punto ${p.indice}`)
          .setLatLng([p.lat, p.lng]);
        // Mostrar/ocultar tooltip al pasar el mouse
        invisibleMarker
          .bindTooltip(tooltip)
          .on("mouseover", () => map.openTooltip(tooltip))
          .on("mouseout", () => map.closeTooltip(tooltip));
        // Guardar tooltip para poder mostrar/ocultar todos
        tooltipRefs.push({ tooltip, circle: invisibleMarker });

        // Crear checkbox para mostrar este vértice
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.checked = false;

        // Evento al marcar el checkbox
        checkbox.onchange = () => {
          if (checkbox.checked) {
            // Mostrar tooltip
            map.openTooltip(tooltip);

            // Si es el primer punto del objeto, enfocar en su geometría
            if (idx === 0) {
              const layer = drawnLayers.find(l => {
                if (l.getBounds) return l.getBounds().contains([p.lat, p.lng]);
                if (l.getLatLng) return l.getLatLng().equals([p.lat, p.lng]);
                return false;
              });

              // Ajustar vista al objeto
              if (layer && layer.getBounds) {
                map.fitBounds(layer.getBounds(), { maxZoom: 17 });
              } else if (layer && layer.getLatLng) {
                map.setView(layer.getLatLng(), 17);
              }
            }

          } else {
            // Ocultar tooltip
            map.closeTooltip(tooltip);
          }
        };
        // 🏷️ Crear etiqueta visual con el checkbox y texto
        const label = document.createElement("label");
        label.className = "block text-sm mb-1";
        label.appendChild(checkbox);
        label.append(` ${nombre} - Punto ${p.indice}`);
        // Agregar al panel lateral
        listaSidebar.appendChild(label);
      });
    }
  }
  // Aplicar el ajuste de vista (zoom y desplazamiento)
  if (bounds) map.fitBounds(bounds);

  // Calcular geometrías (áreas y longitudes)
  if (drawnLayers.length > 0) calcularGeometrias();
  // Escala numérica actualizada al mover o hacer zoom
  map.on('move zoom', calcularEscalaNumerica);
}

/**
 * procesarCSV()
 * -----------------------
 * Lee un archivo CSV seleccionado por el usuario desde un `<input type="file">`
 * y lo procesa como si fuera texto plano, reutilizando la función `procesarTextoPlano()`.
 * 
 * El archivo debe estar ya seleccionado en el input con id="csvUpload".
 */

function procesarCSV() {
  // Obtener el input de carga
  const input = document.getElementById("csvUpload");
  // ❌ Si no hay archivo seleccionado, mostrar alerta
  const file = input.files[0];
  if (!file) {
    alert("Por favor selecciona un archivo CSV.");
    return;
  }
  // Leer el archivo usando FileReader
  const reader = new FileReader();
  // Al terminar de leer el archivo, procesar su contenido
  reader.onload = function (e) {
    const texto = e.target.result;
    procesarTextoPlano(texto); // Reutiliza la lógica de texto plano
  };
  // Iniciar lectura como texto
  reader.readAsText(file);
}

// Botón para mostrar todos los tooltips a la vez
function mostrarTodosTooltips() {
  tooltipRefs.forEach(({ tooltip }) => map.openTooltip(tooltip));
}
// Botón para ocultar todos los tooltips a la vez
function ocultarTodosTooltips() {
  tooltipRefs.forEach(({ tooltip }) => map.closeTooltip(tooltip));
}

// 4. Funciones auxiliares
function limpiarMapa() {
  drawnLayers.forEach(l => map.removeLayer(l));
  drawnLayers = [];

  // Remueve los tooltips
  tooltipRefs.forEach(({ tooltip }) => map.removeLayer(tooltip));
  tooltipRefs = [];

  // Remueve los vértices numerados
  vertexMarkers.forEach(m => map.removeLayer(m));
  vertexMarkers = [];

  // Limpia listas visuales

  document.getElementById("lista-puntos").innerHTML = "";


  const leyenda = document.getElementById("leyendaContenido");
  if (leyenda) leyenda.innerHTML = "";

  const utmContainer = document.getElementById("utmTableContainer");
  if (utmContainer) utmContainer.innerHTML = "";

  const resultados = document.getElementById("resultadosMediciones");
  if (resultados) resultados.innerHTML = "";

  // (Opcional) Reiniciar patrones SVG
  const defs = document.getElementById("leaflet-svg-patterns");
  if (defs) defs.innerHTML = "";
  insertarPatronesSVG();
}

function generarColor() {
  const colores = ["#e6194b", "#3cb44b", "#ffe119", "#4363d8", "#f58231", "#911eb4"];
  return colores[Math.floor(Math.random() * colores.length)];
}

// Botón para mostrar vértices como etiquetas (V1, V2, ...)
document.getElementById("btnMostrarVertices").addEventListener("click", () => {
  // Eliminar anteriores
  vertexMarkers.forEach(m => map.removeLayer(m));
  vertexMarkers = [];

  const prefix = document.getElementById("vertexPrefix").value || "V";
  let index = 1;

  // Lista de colores a usar
  const colors = ["#e74c3c", "#3498db", "#2ecc71", "#f1c40f", "#9b59b6", "#e67e22", "#1abc9c"];

  map.eachLayer(layer => {
    if (!(layer instanceof L.Polygon || layer instanceof L.Polyline)) return;
    if (!map.hasLayer(layer)) return;

    const latlngs = layer.getLatLngs().flat();


    const indices = layer._vertexIndices || [];

    latlngs.forEach((latlng, i) => {
      const color = colors[(index - 1) % colors.length];
      const numero = indices[i] || index; // Usa índice personalizado si existe, si no el automático

      const circleIcon = L.divIcon({
        className: "",
        html: `
      <div style="
        width: 12px;
        height: 12px;
        background-color: white;
        border: 1px solid ${color};
        border-radius: 50%;
        text-align: center;
        line-height: 11px;
        font-size: 7px;
        font-weight: bold;
        box-shadow: 0 0 1px rgba(0, 0, 0, 0.2);
        color: ${color};
        user-select: none;
      ">
        ${prefix}${numero}
      </div>
    `,
        iconSize: [10, 10],
        iconAnchor: [6, 6],
      });

      const marker = L.marker(latlng, { icon: circleIcon }).addTo(map);
      vertexMarkers.push(marker);
      index++;
    });

  });
});

// Botón para ocultar los vértices numerados
document.getElementById("bntOcultarVertices").addEventListener("click", () => {
  vertexMarkers.forEach(marker => map.removeLayer(marker));
  vertexMarkers = [];
});

function descargarKML() {
  const kmlParts = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<kml xmlns="http://www.opengis.net/kml/2.2">`,
    `<Document>`
  ];

  for (const layer of drawnLayers) {
    if (layer._esPatronVisual) continue; // Ignora patrones SVG

    let coords = [];
    let tipo = "";
    let nombre = "Objeto";

    if (layer.getPopup && layer.getPopup()) {
      const contenido = layer.getPopup().getContent();
      const match = contenido.match(/<b>(.*?)<\/b>/);
      if (match) nombre = match[1];
    }


    if (layer instanceof L.Marker) {
      const { lat, lng } = layer.getLatLng();
      coords = `${lng},${lat},0`;
      tipo = "Point";
    } else if (layer instanceof L.Polygon) {
      const latlngs = layer.getLatLngs();
      const isMultiPolygon = Array.isArray(latlngs[0][0]);

      let polygonKML = `
    <Placemark>
      <name>${nombre}</name>
      <Polygon>
  `;

      // Si es multipolígono
      if (isMultiPolygon) {
        for (const poly of latlngs) {
          poly.forEach((ring, i) => {
            let coords = ring.map(p => `${p.lng},${p.lat},0`).join(" ");
            coords += ` ${ring[0].lng},${ring[0].lat},0`;
            polygonKML += i === 0
              ? `<outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>`
              : `<innerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></innerBoundaryIs>`;
          });
        }
      } else {
        // Polígono simple o con huecos
        latlngs.forEach((ring, i) => {
          let coords = ring.map(p => `${p.lng},${p.lat},0`).join(" ");
          coords += ` ${ring[0].lng},${ring[0].lat},0`;
          polygonKML += i === 0
            ? `<outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs>`
            : `<innerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></innerBoundaryIs>`;
        });
      }

      polygonKML += `
      </Polygon>
    </Placemark>
  `;

      kmlParts.push(polygonKML);
      tipo = "Polygon";
    }
    else if (layer instanceof L.Polyline) {
      coords = layer.getLatLngs()
        .map(latlng => `${latlng.lng},${latlng.lat},0`)
        .join(" ");
      tipo = "LineString";
    }


    if (tipo === "Point") {
      kmlParts.push(`
        <Placemark>
          <name>${nombre}</name>
          <Point><coordinates>${coords}</coordinates></Point>
        </Placemark>
      `);
    } else if (tipo === "LineString") {
      kmlParts.push(`
        <Placemark>
          <name>${nombre}</name>
          <LineString>
            <tessellate>1</tessellate>
            <coordinates>${coords}</coordinates>
          </LineString>
        </Placemark>
      `);
    }
  }

  kmlParts.push(`</Document>`);
  kmlParts.push(`</kml>`);

  const blob = new Blob([kmlParts.join("\n")], { type: "application/vnd.google-earth.kml+xml" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;

  //Tomar el nombre del input con id="nombreObjeto"
  let nombreArchivo = document.getElementById("nombreObjeto")?.value.trim();
  if (!nombreArchivo) nombreArchivo = "objetos";
  nombreArchivo = nombreArchivo.replace(/[^a-zA-Z0-9_-]/g, "_");

  a.download = `${nombreArchivo}.kml`;
  a.click();
  URL.revokeObjectURL(url);
}

//Aquí hacemos el cálculo individual para cada polígono o línea:

function calcularGeometrias() {
  const resultados = [];

  drawnLayers.forEach(layer => {
    if (layer._esPatronVisual) return; // ⛔ ignora patrones
    let tipo = "";
    let nombre = "";
    let area = 0;
    let longitud = 0;

    // Obtener nombre desde el popup si existe
    if (layer.getPopup && layer.getPopup()) {
      const contenido = layer.getPopup().getContent();
      const match = contenido.match(/<b>(.*?)<\/b>/);
      if (match) nombre = match[1];
    }

    if (layer instanceof L.Polygon) {
      tipo = "Polígono";

      // Obtener las coordenadas y convertirlas a GeoJSON
      const geojson = layer.toGeoJSON();
      area = turf.area(geojson); // en metros cuadrados

      resultados.push({
        tipo,
        nombre,
        area: area.toFixed(2),
        hectareas: (area / 10000).toFixed(4)
      });

    } else if (layer instanceof L.Polyline && !(layer instanceof L.Polygon)) {
      tipo = "Línea";

      // Convertir a GeoJSON y calcular longitud
      const geojson = layer.toGeoJSON();
      longitud = turf.length(geojson, { units: "kilometers" }); // en kilómetros

      resultados.push({
        tipo,
        nombre,
        longitud: (longitud * 1000).toFixed(2) // Convertimos a metros
      });
    }
  });

  mostrarResultados(resultados);
}


function mostrarResultados(resultados) {
  const contenedor = document.getElementById("resultadosMediciones");
  if (!contenedor) return;

  contenedor.innerHTML = ""; // Limpiar resultados anteriores

  resultados.forEach(r => {
    const div = document.createElement("div");
    div.className = "p-2 border-b";

    if (r.tipo === "Polígono") {
      div.innerHTML = `<strong>${r.nombre}</strong> (${r.tipo}):<br>
        Área aproximada: ${r.area} m²/${r.hectareas} ha`;
    } else if (r.tipo === "Línea") {
      div.innerHTML = `<strong>${r.nombre}</strong> (${r.tipo}):<br>
        Longitud aproximada: ${r.longitud} m`;
    }

    contenedor.appendChild(div);
  });
}



function renderUTMTable(rows, name = "Objeto KML") {
  const container = document.getElementById("utmTableContainer");

  if (!rows.length) {
    container.innerHTML += "<p>No se encontraron coordenadas.</p>";
    return;
  }

  const wrapper = document.createElement("div");
  wrapper.className = "mb-4 border rounded shadow p-2";

  const table = document.createElement("table");
  table.className = "table-auto w-full text-sm text-left border border-gray-300 mb-2";
  table.innerHTML = `
    <thead class="">
      <tr><th colspan="3" class="text-center font-semibold p-2">${name}</th></tr>
      <tr><th class="border p-1">V</th><th class="border p-1">X</th><th class="border p-1">Y</th></tr>
    </thead>
    <tbody>
      ${rows.map(r => `
        <tr>
          <td class="border p-1">${r.v}</td>
          <td class="border p-1">${r.x}</td>
          <td class="border p-1">${r.y}</td>
        </tr>`).join("")}
    </tbody>
  `;

  // Botón de descarga individual
  const btn = document.createElement("button");
  btn.textContent = "Descargar CSV";
  btn.className = "bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-600";
  btn.onclick = () => downloadCSV(rows, name);

  wrapper.appendChild(table);
  wrapper.appendChild(btn);
  container.appendChild(wrapper);
}



function downloadCSV(rows, name = "objeto") {
  const csvContent = "data:text/csv;charset=utf-8,V,X,Y\n" +
    rows.map(r => `${r.v},${r.x},${r.y}`).join("\n");

  const encodedUri = encodeURI(csvContent);
  const link = document.createElement("a");
  const safeName = name.replace(/[^\w\s-]/g, "").replace(/\s+/g, "_").toLowerCase();

  link.setAttribute("href", encodedUri);
  link.setAttribute("download", `${safeName}.csv`);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

document.getElementById("kmlUpload").addEventListener("change", async (event) => {
  const file = event.target.files[0];
  if (!file) return;

  const text = await file.text();
  ultimoKMLTexto = text;
  renderizarDesdeTextoKML(text);
});



function calcularEscalaNumerica() {
  const center = map.getCenter();

  // 2 puntos separados horizontalmente 100 metros
  const punto1 = turf.destination([center.lng, center.lat], 100, 90, { units: 'meters' }); // 100m al Este
  const punto2 = turf.point([center.lng, center.lat]);

  const latlng1 = L.latLng(punto1.geometry.coordinates[1], punto1.geometry.coordinates[0]);
  const latlng2 = L.latLng(center.lat, center.lng);

  // Distancia en metros (debería ser 100)
  const distancia_m = turf.distance(punto1, punto2, { units: 'meters' });

  // Distancia en pantalla en pixeles
  const px = map.latLngToContainerPoint(latlng1).distanceTo(map.latLngToContainerPoint(latlng2));

  const pixeles_por_cm = 37.795; // 96 DPI aproximado
  const cm_en_pantalla = px / pixeles_por_cm;

  const escala = distancia_m / cm_en_pantalla;

  // Mostrar
  document.getElementById('escalaNumerica').textContent = "Escala aproximada: 1:" + Math.round(escala);
}



document.getElementById("btnProcesarTexto").addEventListener("click", () => {
  const texto = document.getElementById("textareaCoordenadas").value.trim();
  if (!texto) {
    alert("Por favor pega alguna coordenada en el área de texto.");
    return;
  }
  procesarTextoPlano(texto);
});

function insertarPatronesSVG() {
  const defsId = "leaflet-svg-patterns";
  let defs = document.getElementById(defsId);

  if (!defs) {
    const svgRoot = document.querySelector("svg.leaflet-zoom-animated");
    if (!svgRoot) {
      map.once("zoomend", insertarPatronesSVG);
      return;
    }

    defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    defs.setAttribute("id", defsId);
    svgRoot.insertBefore(defs, svgRoot.firstChild);
  }

  const patrones = {
    "patron-diagonal": "M 0,0 l 8,8",
    "patron-puntos": "M 2 2 h0.5 v0.5",
    "patron-oscuro": "M 0 0 H 8 V 8 H 0 Z",
    "patron-vertical": "M 4 0 V 8",
    "patron-horizontal": "M 0 4 H 8",
    "patron-cruz": "M 0 4 H 8 M 4 0 V 8",
    "patron-diagonal-inversa": "M 8,0 L 0,8",
    "patron-estrella": "M 0 4 H 8 M 4 0 V 8 M 0 0 L 8 8 M 8 0 L 0 8",
    "patron-diagonal-fina": "M 0,0 l 4,4 M 4,0 l 4,4",
  };

  for (const [id, pathData] of Object.entries(patrones)) {

    // Para el mapa

    if (!document.getElementById(id)) {
      const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
      pattern.setAttribute("id", id);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", "8");
      pattern.setAttribute("height", "8");

      // FONDO BLANCO
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", "8");
      rect.setAttribute("height", "8");
      rect.setAttribute("fill", "white");
      pattern.appendChild(rect);


      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("stroke", "black");
      path.setAttribute("stroke-width", "1");

      pattern.appendChild(path);
      defs.appendChild(pattern);
    }

    // Para la leyenda

    const leyendaId = `${id}-leyenda-base`;
    if (!document.getElementById(leyendaId)) {
      const pattern = document.createElementNS("http://www.w3.org/2000/svg", "pattern");
      pattern.setAttribute("id", leyendaId);
      pattern.setAttribute("patternUnits", "userSpaceOnUse");
      pattern.setAttribute("width", "8");
      pattern.setAttribute("height", "8");

      // Fondo blanco (igual que en los del mapa)
      const rect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
      rect.setAttribute("width", "8");
      rect.setAttribute("height", "8");
      rect.setAttribute("fill", "white");
      pattern.appendChild(rect);



      // Fondo blanco

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", pathData);
      path.setAttribute("stroke", "black");
      path.setAttribute("stroke-width", "1");

      pattern.appendChild(path);
      defs.appendChild(pattern);
    }
  }
}
async function renderizarDesdeTextoKML(text) {
  limpiarMapa();
  document.getElementById("utmTableContainer").innerHTML = "";
  document.getElementById("lista-puntos").innerHTML = "";

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(text, "application/xml");
  const placemarks = xmlDoc.getElementsByTagName("Placemark");

  const patronAsignadoPorNombre = {};
  const patrones = [
    "patron-diagonal",
    "patron-puntos",
    "patron-oscuro",
    "patron-vertical",
    "patron-vertical",
    "patron-horizontal",
    "patron-cruz",
    "patron-diagonal-inversa",
    "patron-estrella",
    "patron-diagonal-fina"
  ];


  let bounds = null;

  for (let placemark of placemarks) {
    const nameTag = placemark.getElementsByTagName("name")[0];
    const nombre = nameTag ? nameTag.textContent.trim() : "Objeto KML";
    const coordsTag = placemark.getElementsByTagName("coordinates")[0];
    if (!coordsTag) continue;

    const coordList = coordsTag.textContent.trim().split(/\s+/);
    const coords = [];
    let zona = null;
    let index = 1;

    for (const coord of coordList) {
      const [lng, lat] = coord.split(",").map(Number);
      if (isNaN(lng) || isNaN(lat)) continue;
      const guessedZona = Math.floor((lng + 180) / 6) + 1;
      if (!zona) zona = guessedZona;
      const [x, y] = proj4("WGS84", `+proj=utm +zone=${zona} +datum=WGS84`, [lng, lat]);
      coords.push({ lat, lng, utm: `${x.toFixed(3)}, ${y.toFixed(3)}`, indice: index++ });
    }

    const utmTableRows = coords.map(c => ({
      v: c.indice,
      x: parseFloat(c.utm.split(",")[0]),
      y: parseFloat(c.utm.split(",")[1])
    }));
    renderUTMTable(utmTableRows, nombre);

    const tipo = coords.length > 2 ? "Polygon" : coords.length === 2 ? "LineString" : "Point";
    const color = generarColor();
    const latlngs = coords.map(p => [p.lat, p.lng]);

    // Patrón fijo por nombre
    if (!patronAsignadoPorNombre[nombre]) {
      let nuevoPatron;
      do {
        nuevoPatron = patrones[Math.floor(Math.random() * patrones.length)];
      } while (nuevoPatron === ultimoPatronUsado);
      patronAsignadoPorNombre[nombre] = nuevoPatron;
      ultimoPatronUsado = nuevoPatron;
    }
    const idPatron = patronAsignadoPorNombre[nombre];

    let shape;

    if (tipo === "Polygon") {
      const estilo = document.getElementById("estiloPoligono")?.value || "blanco";

      let colorContorno = "#ffffff";
      if (estilo === "aleatorio") {
        colorContorno = color;
      }

      shape = L.polygon(latlngs, {
        color: colorContorno,
        weight: 2,
        fillColor: colorContorno,
        fillOpacity: 0.6,
        className: `patron-${idPatron}`
      });

      const patron = L.polygon(latlngs, {
        color: 'transparent',
        weight: 0,
        fillColor: `url(#${idPatron})`,
        fillOpacity: 1,
        interactive: false
      }).addTo(map);
      drawnLayers.push(patron);
      patron._esPatronVisual = true;

      shape.addTo(map).bindPopup(`<b>${nombre}</b>`);
      drawnLayers.push(shape);

      const leyenda = document.getElementById("leyendaContenido");
      if (leyenda) {
        const item = document.createElement("div");
        item.className = "flex items-center mb-1";
        item.innerHTML = `
  <svg width="20" height="20" style="margin-right:8px; border:1px solid #ccc;" id="svg-${nombre}">
    <rect width="20" height="20" fill="${colorContorno}" />
    <rect id="rect-${nombre}" width="20" height="20" fill="url(#${idPatron})" />
  </svg>
  <span class="mr-2 text-xs">${nombre}</span>
  <select data-nombre="${nombre}" class="text-xs border rounded px-1 py-0.5">
    ${patronesDisponibles.map(p => `<option value="${p}" ${p === idPatron ? 'selected' : ''}>${p.replace('patron-', '')}</option>`).join("")}
  </select>
`;
        leyenda.appendChild(item);

        const selector = item.querySelector("select");
        selector.addEventListener("change", e => {
          const nuevoPatron = e.target.value;
          const nombre = e.target.dataset.nombre;

          // Actualizar símbolo en leyenda
          const rect = document.getElementById(`rect-${nombre}`);
          if (rect) rect.setAttribute("fill", `url(#${nuevoPatron})`);

          // Actualizar polígonos en el mapa
          map.eachLayer(layer => {
            if (layer._esPatronVisual && layer.getPopup && layer.getPopup().getContent().includes(`<b>${nombre}</b>`)) {
              layer.setStyle({ fillColor: `url(#${nuevoPatron})` });
            }
          });
        });



      }

    } else if (tipo === "LineString") {
      shape = L.polyline(latlngs, { color }).addTo(map);
      drawnLayers.push(shape);
    } else {
      for (const p of coords) {
        const marker = L.marker([p.lat, p.lng], {
          title: `${nombre} Punto ${p.indice}`
        }).addTo(map).bindPopup(`<b>${nombre}</b><br>Punto ${p.indice}<br>UTM (${p.utm})`);
        drawnLayers.push(marker);
      }
      continue;
    }

    shape._vertexIndices = coords.map(p => p.indice);

    if (!bounds) bounds = shape.getBounds();
    else bounds.extend(shape.getBounds());
  }

  if (bounds) map.fitBounds(bounds);
  if (drawnLayers.length > 0) calcularGeometrias();
  map.on('move zoom', calcularEscalaNumerica);
}