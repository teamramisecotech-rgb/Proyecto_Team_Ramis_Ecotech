/****************************************************************************** 
 VCI / TCI / VHI (2020-01 → 2025-08) desde ASSETS
 ------------------------------------------------
 • Panel de controles (izq.) con botón MOSTRAR/OCULTAR en la PARTE INFERIOR
   (al ocultar, queda SOLO el botón “Mostrar ▼” sin marco blanco)
 • Serie VHI (arriba-derecha) INICIA COLAPSADA con botón “Mostrar ▼”
   (al ocultar, queda SOLO el botón sin marco blanco)
 • Leyenda flotante de categorías (abajo-izquierda)
 • Tamaños de letra configurables (título, etiquetas, botones)
 • FIX móvil: reconstrucción diferida del chart para evitar recorte/compresión
******************************************************************************/

/* ====== Tipografías del panel izquierdo ====== */
var UI_FONT_TITLE  = 16;  // Título
var UI_FONT_LABEL  = 11;  // “Distritos de Puno:”, “Año:”, “Mes:”
var UI_FONT_BUTTON = 11;  // “Mostrar VHI” y toggles

/* ====== Tamaño del gráfico (ajusta a gusto) ====== */
var CHART_W = 300;   // en móvil puedes usar 260
var CHART_H = 200;   // en móvil puedes usar 160
var SHELL_W = CHART_W + 40;

/* ===================== Parámetros / rutas ===================== */
var ASSET_BASE = 'projects/team-ramis-02/assets/';

/* ===================== AOI: Distritos ===================== */
var DIST_FC    = ee.FeatureCollection('projects/team-ramis-05/assets/DISTRITOS_PUNO');
var DIST_FIELD = 'NOMBDIST';

/* ===================== Utilidades ===================== */
function pad2(n){ return (n < 10 ? '0' + n : '' + n); }

/* Cargar IC desde assets mensuales */
function loadIndexIC(prefix){
  var images = [];
  for (var y = 2020; y <= 2025; y++){
    var lastM = (y === 2025 ? 8 : 12);
    for (var m = 1; m <= lastM; m++){
      var id  = ASSET_BASE + prefix + '_' + String(y) + pad2(m) + '_PUNO_BUFFER_MODIS';
      var img = ee.Image(id).select(prefix)
        .set('system:time_start', ee.Date.fromYMD(y, m, 1).millis())
        .set('year',  y).set('month', m).set('id', id);
      images.push(img);
    }
  }
  return ee.ImageCollection(images);
}

/* ===================== Colecciones ===================== */
var VCI_IC = loadIndexIC('VCI');
var TCI_IC = loadIndexIC('TCI');
var VHI_IC = loadIndexIC('VHI');

/* ===================== MAPA ===================== */
var map = ui.Map();
ui.root.widgets().reset([map]);
map.setOptions('TERRAIN');
map.setControlVisibility({mapTypeControl: false, zoomControl: false});

/* ===================== Contornos arriba ===================== */
var outlineStyle = {color: '#007BFF', width: 2, fillColor: '00000000'};
var outlineImg   = DIST_FC.style(outlineStyle);
var outlineLayer = ui.Map.Layer(outlineImg, {}, 'Distritos (contorno)', true);
map.add(outlineLayer);

var PICOTANI_FC   = ee.FeatureCollection('projects/team-ramis-01/assets/cc_picotani_WGS84');
var PICOTANI_FC_1 = ee.FeatureCollection('projects/team-ramis-05/assets/Challhuani_Pacoytriangulo1');
var PICOTANI_FC_2 = ee.FeatureCollection('projects/team-ramis-05/assets/Tambokarkas5');

var aoiStyle = {color:'#000000', width:2, fillColor:'00000000'};
var picotaniLayer   = ui.Map.Layer(PICOTANI_FC.style(aoiStyle),   {}, 'AOI Picotani (contorno)', true);
var picotaniLayer_1 = ui.Map.Layer(PICOTANI_FC_1.style(aoiStyle), {}, 'AOI Chalhuani (contorno)', true);
var picotaniLayer_2 = ui.Map.Layer(PICOTANI_FC_2.style(aoiStyle), {}, 'AOI Tambojarkas (contorno)', true);

map.add(picotaniLayer);
map.add(picotaniLayer_1);
map.add(picotaniLayer_2);

function bringOutlinesToFront(){
  map.layers().remove(outlineLayer);
  map.layers().remove(picotaniLayer);
  map.layers().remove(picotaniLayer_1);
  map.layers().remove(picotaniLayer_2);
  map.layers().add(outlineLayer);
  map.layers().add(picotaniLayer);
  map.layers().add(picotaniLayer_1);
  map.layers().add(picotaniLayer_2);
}

/* ===================== Clasificación y paleta (mapa) ===================== */
var breaks  = [0.15, 0.25, 0.35, 0.45, 0.55, 0.65, 0.75, 0.85];
var palette = ['#7b0000','#ff0000','#ff8c00','#ffc04d','#ffff66','#98fb98','#32cd32','#228b22','#0b5d13'];
function classifyVHI(img){
  var cls = ee.Image(0)
    .where(img.lt(breaks[0]), 0)
    .where(img.gte(breaks[0]).and(img.lt(breaks[1])), 1)
    .where(img.gte(breaks[1]).and(img.lt(breaks[2])), 2)
    .where(img.gte(breaks[2]).and(img.lt(breaks[3])), 3)
    .where(img.gte(breaks[3]).and(img.lt(breaks[4])), 4)
    .where(img.gte(breaks[4]).and(img.lt(breaks[5])), 5)
    .where(img.gte(breaks[5]).and(img.lt(breaks[6])), 6)
    .where(img.gte(breaks[6]).and(img.lt(breaks[7])), 7)
    .where(img.gte(breaks[7]), 8);
  return cls.toInt();
}

/* ===================== Leyenda flotante ===================== */
var catTexts = [
  'Sequía Excepcional','Sequía Extrema','Sequía Severa','Sequía Moderada',
  'Casi Normal','Anormalmente Húmeda','Moderada Húmeda','Severa Húmeda','Extremadamente Húmeda'
];
function makeRow(colorHex, text){
  var row = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'),
                      style: {margin:'0 0 2px 0', padding:'0'}});
  var swatch = ui.Label('', {backgroundColor: colorHex, padding: '5px',
                             margin: '0 6px 0 0', border: '1px solid #888'});
  var lbl = ui.Label(text, {margin:'0', fontSize:'11px'});
  row.add(swatch); row.add(lbl);
  return row;
}

/* ===================== Panel de controles (izquierda) ===================== */
var W = 130;
var selDist  = ui.Select({placeholder:'Cargando distritos…', style:{width: W + 'px', fontSize: UI_FONT_LABEL + 'px'}});
var years    = []; for (var y = 2020; y <= 2025; y++) years.push(String(y));
var months   = ['01','02','03','04','05','06','07','08','09','10','11','12'];
var selYear  = ui.Select({items: years,  value: '2022', style:{width: W + 'px', fontSize: UI_FONT_LABEL + 'px'}});
var selMonth = ui.Select({items: months, value: '12',   style:{width: W + 'px', fontSize: UI_FONT_LABEL + 'px'}});
var btnShow  = ui.Button({label:'Mostrar VHI', style:{width: W + 'px', fontSize: UI_FONT_BUTTON + 'px'}});

// Título (usa UI_FONT_TITLE)
// Título (centrado)
var panelTitle = ui.Label('Índice de Salud de la Vegetación (VHI)', {
  fontWeight: 'bold',
  fontSize: UI_FONT_TITLE + 'px',
  color: 'green',
  textAlign: 'center',      // ← centra el texto
  stretch: 'horizontal',    // ← ocupa todo el ancho del panel
  margin: '0 0 6px 0'
});


// Helper para etiqueta con tamaño configurable
function label(text){ return ui.Label(text, {margin:'6px 0 1px 0', fontSize: UI_FONT_LABEL + 'px'}); }

// Contenido del formulario
var controlsContent = ui.Panel({
  widgets: [
    label('Distritos de Puno:'), selDist,
    label('Año:'),               selYear,
    label('Mes:'),               selMonth,
    ui.Label('', {margin:'2px 0 0 0'}), btnShow
  ],
  style: {margin:'0', padding:'0'}
});

// BOTÓN INFERIOR (al ocultar deja SOLO el botón sin marco blanco)
var formCollapsed = false;
var bottomToggleBtn = ui.Button({
  label: 'Ocultar ▲',
  style: {margin:'6px auto 0 auto', padding:'2px 8px', fontSize: UI_FONT_BUTTON + 'px'},
  onClick: function(){
    formCollapsed = !formCollapsed;
    if (formCollapsed){
      panel.widgets().reset([bottomToggleBtn]);
      bottomToggleBtn.setLabel('Mostrar ▼');
      bottomToggleBtn.style().set({margin:'0', padding:'4px 10px', fontSize: (UI_FONT_BUTTON+1) + 'px'});
      panel.style().set({ width: 'auto', padding: '0', backgroundColor: 'rgba(255,255,255,0)', border: '0' });
    } else {
      panel.widgets().reset([panelTitle, controlsContent, bottomToggleBtn]);
      bottomToggleBtn.setLabel('Ocultar ▲');
      bottomToggleBtn.style().set({margin:'6px auto 0 auto', padding:'2px 8px', fontSize: UI_FONT_BUTTON + 'px'});
      panel.style().set({ width: '165px', padding: '8px', backgroundColor: 'rgba(255,255,255,0.95)', border: '1px solid #ddd' });
    }
  }
});

// Contenedor del panel izquierdo
var panel = ui.Panel({
  widgets: [panelTitle, controlsContent, bottomToggleBtn],
  style:{ position:'top-left', width:'165px', padding:'8px', backgroundColor:'rgba(255,255,255,0.95)', border:'1px solid #ddd' }
});
map.add(panel);

/* === LEYENDA FLOTANTE (bottom-left) === */
var legend = ui.Panel({
  style: { position: 'bottom-left', padding: '5px', backgroundColor: 'rgba(255, 255, 255, 0.90)', border: '1px solid #000', width: '165px' }
});
legend.add(ui.Label({ value: 'CATEGORÍAS DE SEQUÍA (VHI)', style: {fontWeight: 'bold', fontSize: '10px', textAlign: 'center', margin: '0 0 4px 0'} }));
legend.add(ui.Label('', {backgroundColor:'#e0e0e0', margin:'0 0 4px 0', padding:'1px'}));
for (var i = 0; i < palette.length; i++) legend.add(makeRow(palette[i], catTexts[i]));
map.add(legend);

/* =========== Ventana serie de tiempo con BOTÓN INFERIOR (INICIA COLAPSADA) =========== */
var isChartCollapsed = true;  // <-- inicia colapsada
var lastDistrictName = null;
var lastDistrictGeom = null;

// Contenido real del chart
var chartHolder = ui.Panel({style: {margin: '0', padding: '0'}});

// FIX MÓVIL: reconstrucción diferida
var rebuildChartDebounced = ui.util.debounce(function () {
  if (lastDistrictName && lastDistrictGeom) {
    var fresh = buildVHIChart(lastDistrictName, lastDistrictGeom);
    chartHolder.widgets().reset([fresh]);
  }
}, 450);

// Botón inferior para la gráfica
var chartBottomToggle = ui.Button({
  label: 'Mostrar ▼',                         // <-- etiqueta inicial
  style: {margin:'0', padding:'4px 10px', fontSize: UI_FONT_BUTTON + 'px'}
});

// Contenedor del panel de la gráfica
var chartShell = ui.Panel({
  widgets: [chartBottomToggle],               // <-- solo botón al iniciar
  style: {
    position: 'top-right',
    width: 'auto',                            // <-- sin marco al iniciar
    padding: '0',
    backgroundColor: 'rgba(255,255,255,0)',
    border: '0'
  }
});
map.add(chartShell);

// Lógica del botón (expandir/colapsar)
chartBottomToggle.onClick(function(){
  isChartCollapsed = !isChartCollapsed;
  if (!isChartCollapsed){
    // Expandir: poner chart + botón y restaurar marco
    chartShell.widgets().reset([chartHolder, chartBottomToggle]);
    chartBottomToggle.setLabel('Ocultar ▲');
    chartBottomToggle.style().set({margin:'8px auto 0 auto', padding:'4px 10px'});
    chartShell.style().set({
      width: SHELL_W + 'px',
      padding: '8px',
      backgroundColor: 'rgba(255,255,255,0.95)',
      border: '1px solid #ddd'
    });
    // construir + reconstrucción diferida
    if (lastDistrictName && lastDistrictGeom){
      var freshChart = buildVHIChart(lastDistrictName, lastDistrictGeom);
      chartHolder.widgets().reset([freshChart]);
      rebuildChartDebounced();
    }
  } else {
    // Colapsar: dejar solo botón sin marco
    chartShell.widgets().reset([chartBottomToggle]);
    chartBottomToggle.setLabel('Mostrar ▼');
    chartBottomToggle.style().set({margin:'0', padding:'4px 10px'});
    chartShell.style().set({
      width: 'auto',
      padding: '0',
      backgroundColor: 'rgba(255,255,255,0)',
      border: '0'
    });
  }
});

/* Construye la gráfica con tamaño controlado */
function buildVHIChart(name, geom){
  var scale = 1000;
  var VHI_WITH_LINES = VHI_IC.map(function(img){
    var thr = ee.Image.constant([0.10, 0.20, 0.30]).rename(['B_T01','C_T02','D_T03']).toFloat();
    return img.select(['VHI'], ['A_VHI']).addBands(thr).copyProperties(img, img.propertyNames());
  });
  var sel = VHI_WITH_LINES.select(['A_VHI','B_T01','C_T02','D_T03']);
  var chart = ui.Chart.image.series(sel, geom, ee.Reducer.mean(), scale, 'system:time_start')
    .setSeriesNames(['VHI (media)','Sequía extrema (0.10)','Sequía severa  (0.20)','Sequía moderada (0.30)'])
    .setOptions({
      width: CHART_W, height: CHART_H,
      chartArea: {left: 60, top: 36, width: '80%', height: '70%'},
      title: 'VHI (media) — ' + name + ' 2020-01 → 2025-08' + '\n' +
             'Líneas: roja = Sequía extrema | azul = Sequía severa | verde = Sequía moderada ',
      vAxis: { title:'VHI (0–1)', viewWindow:{min:0, max:1}, ticks:[0,0.1,0.2,0.3,0.4,0.5,0.6,0.7,0.8,0.9,1] },
      series: { 0:{color:'#000000', lineWidth:2}, 1:{color:'#d62728', lineDashStyle:[6,3], lineWidth:2}, 2:{color:'#1f77b4', lineDashStyle:[6,3], lineWidth:2}, 3:{color:'#2ca02c', lineDashStyle:[6,3], lineWidth:2} },
      legend: {position:'none'}
    });
  return chart;
}

/* ===================== Lógica ===================== */
var vhiLayer = null;
function getAOIfromName(name){ var feat = DIST_FC.filter(ee.Filter.eq(DIST_FIELD, name)).first(); return ee.Feature(feat).geometry(); }
function centerOnDistrict(name, zoom){ var geom = getAOIfromName(name); map.centerObject(geom, (zoom || 11)); bringOutlinesToFront(); }
function updateCharts(name){
  var geom = getAOIfromName(name);
  lastDistrictName = name; lastDistrictGeom = geom;
  // si está expandido, actualiza el chart; si está colapsado, solo guarda el último
  if (!isChartCollapsed){
    var chart = buildVHIChart(name, geom);
    chartHolder.widgets().reset([chart]);
    rebuildChartDebounced();
  }
}
function showVHISelectedMonth(name){
  var y = parseInt(selYear.getValue(), 10);
  var m = parseInt(selMonth.getValue(), 10);
  var geom = getAOIfromName(name);
  var oneCol = VHI_IC.filter(ee.Filter.eq('year',  y)).filter(ee.Filter.eq('month', m));
  oneCol.size().evaluate(function(n){
    if (!n || n === 0){ print('No hay VHI para ' + y + '-' + pad2(m)); return; }
    var one = ee.Image(oneCol.first());
    var cls = classifyVHI(one.select('VHI')).clip(geom);
    if (vhiLayer) map.layers().remove(vhiLayer);
    vhiLayer = ui.Map.Layer(cls, {min:0, max:8, palette: palette}, 'VHI '+y+'-'+pad2(m), true);
    map.add(vhiLayer);
    bringOutlinesToFront();
    map.centerObject(geom, 11);
  });
}

/* ===================== Eventos UI ===================== */
btnShow.onClick(function(){
  var name = selDist.getValue();
  if (!name){ print('Selecciona un distrito.'); return; }
  showVHISelectedMonth(name);
});
selDist.onChange(function(name){
  if (!name) return;
  centerOnDistrict(name, 11);
  updateCharts(name);
  showVHISelectedMonth(name);
});

/* ===================== Carga distritos + estado inicial ===================== */
ee.List(DIST_FC.aggregate_array(DIST_FIELD)).distinct().sort().evaluate(function(list){
  selDist.items().reset(list);
  if (list && list.indexOf('PUTINA') > -1){
    selDist.setValue('PUTINA', true); // render inicial (chart sigue colapsado)
  }
});

// Mantener contornos arriba
bringOutlinesToFront();
