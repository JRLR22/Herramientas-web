// Capas base
const capaOscura = L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
  attribution: '&copy; <a href="https://carto.com/">CARTO</a>'
});
const capaClaro = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; OpenStreetMap contributors'
});
const capaSat = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri'
});
const capaTopografica = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', {
  attribution: 'Tiles © Esri — USGS, TANA'
});

// Crear el mapa
const map = L.map('map', {
  center: [23.6345, -102.5528],
  zoom: 5,
  layers: [capaSat]
});
L.control.layers({
  'Oscuro': capaOscura,
  'Claro': capaClaro,
  'Satélite': capaSat,
  'Topográfico': capaTopografica
}).addTo(map);

// Almacenar capas por nombre de objeto
let objectLayers = {};

// Conversión GMS a Decimal
function dmsToDecimal(dmsStr) {
  const regex = /(\d+)[°:\s](\d+)[']?(\d+(?:\.\d+)?)[\"]?([NSEW])/i;
  const match = dmsStr.trim().match(regex);
  if (!match) return null;

  let [, degrees, minutes, seconds, direction] = match;
  let decimal = parseFloat(degrees) + parseFloat(minutes) / 60 + parseFloat(seconds) / 3600;
  if (['S', 'W'].includes(direction.toUpperCase())) decimal *= -1;
  return decimal;
}

// Convertir a UTM
function convertToUTM(lat, lon) {
  const zone = Math.floor((lon + 180) / 6) + 1;
  const projUTM = `+proj=utm +zone=${zone} +datum=WGS84 +units=m +no_defs`;
  const [easting, northing] = proj4('EPSG:4326', projUTM, [lon, lat]);
  return { e: easting.toFixed(2), n: northing.toFixed(2), zone };
}

// Determinar si es coordenada decimal
function isDecimal(line) {
  return /^-?\d+(\.\d+)?\s*,\s*-?\d+(\.\d+)?$/.test(line.trim());
}

// Parsear una línea de coordenada
function parseCoordinate(line) {
  if (isDecimal(line)) {
    const [lat, lon] = line.split(',').map(Number);
    return [lat, lon];
  } else {
    const [latStr, lonStr] = line.split(',');
    const lat = dmsToDecimal(latStr);
    const lon = dmsToDecimal(lonStr);
    return (lat !== null && lon !== null) ? [lat, lon] : null;
  }
}

// Colores
function getColor(i) {
  const colors = ['#4ade80', '#60a5fa', '#f87171', '#facc15', '#c084fc', '#38bdf8'];
  return colors[i % colors.length];
}

// Convertir y renderizar
function convertAndRender() {
  const input = document.getElementById('coord-input').value.trim();
  const blocks = input.split(/-{3,}/);
  const tableBody = document.querySelector('#utm-table tbody');
  const sidebar = document.getElementById('object-list');

  // Reset
  tableBody.innerHTML = '';
  sidebar.innerHTML = '';
  Object.values(objectLayers).forEach(layer => map.removeLayer(layer));
  objectLayers = {};

    // 🧽 Limpiar geojsonFeatures para evitar duplicados
  window.geojsonFeatures = [];

  blocks.forEach((block, index) => {
    const lines = block.trim().split('\n').filter(Boolean);
    let name = `Objeto ${index + 1}`;
    let tipo = 'Polígono';
    const coords = [];

    lines.forEach(line => {
      if (line.toLowerCase().startsWith('nombre:')) {
        name = line.split(':')[1].trim();
      } else if (line.toLowerCase().startsWith('tipo:')) {
        tipo = line.split(':')[1].trim().toLowerCase();
      } else {
        const parsed = parseCoordinate(line);
        if (parsed) coords.push(parsed);
      }
    });

    if (coords.length === 0) return;

    // Mostrar en tabla
    coords.forEach(([lat, lon], i) => {
      const utm = convertToUTM(lat, lon);
      const row = `<tr>
        <td class="border border-gray-600 px-2">${name}</td>
        <td class="border border-gray-600 px-2">${tipo}</td>
        <td class="border border-gray-600 px-2">P${i + 1}</td>
        <td class="border border-gray-600 px-2">${utm.e}</td>
        <td class="border border-gray-600 px-2">${utm.n}</td>
        <td class="border border-gray-600 px-2">${utm.zone}</td>
      </tr>`;
      tableBody.insertAdjacentHTML('beforeend', row);
    });

    // Dibujar en el mapa
    let layer;
    const color = getColor(index);

    if (tipo === 'polígono' && coords.length >= 3) {
      layer = L.polygon(coords, { color, fillOpacity: 0.3 }).addTo(map);
    } else if (tipo === 'línea' && coords.length >= 2) {
      layer = L.polyline(coords, { color }).addTo(map);
    } else if (tipo === 'punto') {
      layer = L.marker(coords[0]).addTo(map);
    }

    if (layer) {
      layer.bindPopup(`<b>${name}</b><br>Tipo: ${tipo}`);
      objectLayers[name] = layer;

      const li = document.createElement('li');
      li.innerHTML = `<button onclick="zoomToObject('${name}')" class="bg-gray-700 hover:bg-gray-600 px-2 py-1 rounded w-full">${name}</button>`;
      sidebar.appendChild(li);

if (!window.geojsonFeatures) window.geojsonFeatures = [];

const geojson = layer.toGeoJSON();
geojson.properties = { name, tipo };
window.geojsonFeatures.push(geojson);

    }
  });
}

// Zoom al objeto
function zoomToObject(name) {
  const layer = objectLayers[name];
  if (layer) {
    if (layer.getBounds) {
  map.fitBounds(layer.getBounds(), { maxZoom: 18 });
} else if (layer.getLatLng) {
  map.setView(layer.getLatLng(), 18);
}

    layer.openPopup();
  }
}

// Asociar evento al botón
document.getElementById('convert-btn').addEventListener('click', convertAndRender);

    // Exportar tabla como CSV
    function descargarTabla() {
      const rows = [['Nombre', 'Tipo', 'Punto', 'Este', 'Norte', 'Zona']];
      document.querySelectorAll('#utm-table tbody tr').forEach(tr => {
        const row = [];
        tr.querySelectorAll('td').forEach(td => row.push(td.textContent));
        rows.push(row);
      });
      const csv = rows.map(r => r.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'coordenadas_utm.csv';
      a.click();
      URL.revokeObjectURL(url);
    }

function descargarKML() {
  if (!window.geojsonFeatures || window.geojsonFeatures.length === 0) {
    alert("Primero convierte y muestra los objetos en el mapa.");
    return;
  }

  const geojson = {
    type: "FeatureCollection",
    features: window.geojsonFeatures
  };

  const kml = tokml(geojson); // requiere librería tokml.js
  const blob = new Blob([kml], { type: 'application/vnd.google-earth.kml+xml' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "coordenadas.kml";
  a.click();
  URL.revokeObjectURL(url);
}

function limpiarTodo() {
  // Quitar capas del mapa
  Object.values(objectLayers).forEach(layer => map.removeLayer(layer));
  objectLayers = {};

  // Limpiar tabla
  document.querySelector('#utm-table tbody').innerHTML = '';

  // Limpiar barra lateral
  document.getElementById('object-list').innerHTML = '';

  // Limpiar textarea
  document.getElementById('coord-input').value = '';

  // Limpiar features para KML
  window.geojsonFeatures = [];

  // Resetear vista del mapa
  map.setView([23.6345, -102.5528], 5);

  // Cerrar popups abiertos
  map.closePopup();
}
