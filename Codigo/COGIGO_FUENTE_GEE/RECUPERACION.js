/**** APP — Theil–Sen + Clasificación + Serie NDVI (con búsqueda por coordenada + Animación RGB) ****/
/* ====== PARÁMETROS ====== */
var ASSET_ID = 'projects/team-ramis-05/assets/NDVI_SENTINEL_LANDSAT_2016_2025';
var BAND = 'NDVI';
var IS_STACK = true; // apilado multibanda
var FIRST_MONTH = '2016-01-01';
var CHART_SCALE = 10; // Serie global (para la curva azul)
var SERIES_START = ee.Date('2016-01-01');
var SERIES_END = ee.Date('2025-10-01'); // exclusivo → muestra hasta 2025-09
// AOI distritos
var DISTRI_FC_ASSET = 'projects/team-ramis-05/assets/DISTRITOS_PUNO';
var DISTRI_FC = ee.FeatureCollection(DISTRI_FC_ASSET);
var DISTRI_KEY = 'NOMBDIST';
// Clasificación
var MODE_DEFAULT = 'cuantiles'; // 'absoluto' | 'cuantiles'
var ABS_THRESH = [0.02, 0.05, 0.08]; // NDVI/año
var CLASS_PALETTE = ['#bdbdbd', '#e5f5e0', '#a1d99b', '#31a354', '#006d2c'];
var CLASS_NAMES = ['Sin/Estable', 'Baja', 'Media', 'Moderada', 'Alta'];
var CLASS_NAMES_EE = ee.List(CLASS_NAMES);
// Descarga raster
var EXPORT_RASTER_SCALE = 30; // metros
// Puntos de restauración
var PUNTOS_ASSET = 'projects/team-ramis-05/assets/PUNTOS_RESTAURACION';
var PUNTOS_FC = ee.FeatureCollection(PUNTOS_ASSET); // columna 'Name'

/* ====== MOSAICOS RGB 2016–2025 (para animación y capa RGB) ====== */
var MOSAICOS = {
  "2016": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2016"),
  "2017": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2017"),
  "2018": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2018"),
  "2019": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2019"),
  "2020": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2020"),
  "2021": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2021"),
  "2022": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2022"),
  "2023": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2023"),
  "2024": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2024"),
  "2025": ee.Image("projects/team-ramis-01/assets/MOSAICO_PUTINA_2025")
};
var visRGB = {bands: ["swir2","nir","red"], min: 0, max: 0.6};
// Paquete para anotar texto (año) en la imagen
var text = require('users/gena/packages:text');
var annotations = [
  {position: 'right', offset: '1%', margin: '22%', property: 'label', scale: 200,
   textColor: 'ffffff', outlineColor: '000000', outlineWidth: 3}
];
function addAnno(img, geom) { return text.annotateImage(img, {}, geom, annotations); }

/* ===================== HELPERS ===================== */
function stackToIC(img, firstDate, outBand){
  var n = img.bandNames().size();
  var idx = ee.List.sequence(0, ee.Number(n).subtract(1));
  var newNames = idx.map(function(k){ return ee.String('b').cat(ee.Number(k).toInt().format()); });
  var renamed = img.rename(newNames);
  return ee.ImageCollection.fromImages(idx.map(function(k){
    var ki = ee.Number(k).toInt();
    var date = ee.Date(firstDate).advance(ki, 'month');
    var b = ee.String('b').cat(ki.format());
    return renamed.select([b]).rename(outBand).set('system:time_start', date.millis());
  }));
}
function prepIC(ic, band){
  return ic.select([band]).map(function(im){
    var nd = im.updateMask(im.select(band).gt(-1).and(im.select(band).lte(1)));
    return nd.copyProperties(im, ['system:time_start']);
  });
}
function addTimeBand(ic, band, d0){
  return ic.map(function(im){
    var nd = im.select([band]).toFloat();
    var tYears = im.date().difference(d0, 'year');
    var t = ee.Image.constant(tYears).rename('t').toFloat().updateMask(nd.mask());
    return t.addBands(nd);
  });
}
function visFromPercentiles(img, geom){
  var stats = img.reduceRegion({
    reducer: ee.Reducer.percentile([5,95]),
    geometry: geom,
    scale: 30,
    maxPixels: 1e13
  }).getInfo();
  var p5 = stats ? stats['slope_p5'] : -0.05;
  var p95 = stats ? stats['slope_p95'] : 0.05;
  var vmax = Math.max(Math.abs(p5), Math.abs(p95));
  return {min: -vmax, max: vmax,
          palette: ['#313695','#4575b4','#74add1','#abd9e9','#e0f3f8',
                    '#ffffbf','#fee090','#fdae61','#f46d43','#d73027','#a50026']};
}
function classifyRecovery(slopeImg, AOI, mode){
  var pos = slopeImg.updateMask(slopeImg.gt(0));
  var edges = ee.List(ABS_THRESH);
  if (mode === 'cuantiles') {
    var npos = ee.Number(pos.reduceRegion({
      reducer: ee.Reducer.count(), geometry: AOI, scale: 30,
      maxPixels: 1e13, bestEffort: true}).get('slope'));
    var statsDict = ee.Dictionary(pos.reduceRegion({
      reducer: ee.Reducer.percentile([25,50,75]), geometry: AOI, scale: 30,
      maxPixels: 1e13, bestEffort: true}));
    var cond = ee.Algorithms.If(npos.gt(0),
      ee.Algorithms.If(statsDict.contains('slope_p25'),
        ee.Algorithms.If(statsDict.contains('slope_p50'),
          ee.Algorithms.If(statsDict.contains('slope_p75'), true, false), false), false), false);
    edges = ee.List(ee.Algorithms.If(cond,
      ee.List([ee.Number(statsDict.get('slope_p25')),
               ee.Number(statsDict.get('slope_p50')),
               ee.Number(statsDict.get('slope_p75'))]),
      ee.List(ABS_THRESH)));
  }
  var e1 = ee.Number(edges.get(0)), e2 = ee.Number(edges.get(1)), e3 = ee.Number(edges.get(2));
  return ee.Image(0)
    .where(slopeImg.gt(0).and(slopeImg.lte(e1)), 1)
    .where(slopeImg.gt(e1).and(slopeImg.lte(e2)), 2)
    .where(slopeImg.gt(e2).and(slopeImg.lte(e3)), 3)
    .where(slopeImg.gt(e3), 4)
    .rename('class_id').clip(AOI);
}

/* ====== LEYENDAS DENTRO DEL MAPA ====== */
function legendCatsPanel(names, palette){
  var p = ui.Panel({style:{padding:'8px', backgroundColor:'rgba(255,255,255,0.9)'}});
  p.add(ui.Label('Recuperación', {fontWeight:'bold'}));
  for (var i=0; i<names.length; i++){
    var box = ui.Label({style:{backgroundColor: palette[i], padding:'8px', margin:'0 6px 4px 0'}});
    var lab = ui.Label(names[i], {margin:'0 0 4px 0'});
    p.add(ui.Panel([box, lab], ui.Panel.Layout.flow('horizontal')));
  }
  return p;
}
function legendSlopePanel(palette, min, max){
  var bar = ui.Thumbnail({image: ee.Image.pixelLonLat().select('longitude'),
    params: {bbox:[0,0,1,0.1], dimensions:'256x12', min:0, max:1, palette:palette},
    style: {stretch:'horizontal', margin:'4px 0'}});
  var minLbl = ui.Label(min.toFixed ? min.toFixed(3) : min, {margin:'0 6px 0 0'});
  var maxLbl = ui.Label(max.toFixed ? max.toFixed(3) : max, {margin:'0 0 0 6px'});
  var filler = ui.Panel(null, ui.Panel.Layout.flow('horizontal'), {stretch:'horizontal'});
  var row = ui.Panel([minLbl, filler, maxLbl], ui.Panel.Layout.flow('horizontal'));
  var p = ui.Panel({style:{padding:'8px', backgroundColor:'rgba(255,255,255,0.9)'}});
  p.add(ui.Label('Pendiente Theil–Sen', {fontWeight:'bold'}));
  p.add(bar); p.add(row);
  return p;
}

/* ===================== MAPA Y UI ===================== */
Map.setOptions('HYBRID');
Map.setControlVisibility({zoomControl:false, layerList:true,
                          mapTypeControl:false, scaleControl:false,
                          fullscreenControl:false});
Map.drawingTools().setShown(false);
Map.style().set('cursor', 'crosshair');

function crossLayer(point, sizeMeters, color) {
  var coords = point.coordinates();
  var lon = ee.Number(coords.get(0)), lat = ee.Number(coords.get(1));
  var p = ee.Geometry.Point([lon, lat]);
  var b = p.buffer(sizeMeters).bounds();
  var rect = ee.Geometry(b).coordinates().get(0);
  var p0 = ee.List(rect).get(0), p2 = ee.List(rect).get(2), p3 = ee.List(rect).get(3);
  var horiz = ee.Geometry.LineString([[ee.Number(ee.List(p3).get(0)), lat],
                                      [ee.Number(ee.List(p2).get(0)), lat]]);
  var vert  = ee.Geometry.LineString([[lon, ee.Number(ee.List(p0).get(1))],
                                      [lon, ee.Number(ee.List(p3).get(1))]]);
  return ui.Map.Layer(ee.FeatureCollection([ee.Feature(horiz), ee.Feature(vert)])
                      .style({color: color || 'cyan', width: 2}), {}, 'Punto', true, 0.9);
}

/* ===================== UI PANEL ===================== */
var panel = ui.Panel({style:{width:'400px'}});
panel.add(ui.Label('ESTADO DE LA VEGETACIÓN DESPUES DE LA SEQUIA', {fontWeight:'bold'}));
panel.add(ui.Label('Rango de fechas para el analisis de la recuperación'));
var txtStart = ui.Textbox({value:'2022-11-01', placeholder:'YYYY-MM-DD'});
var txtEnd   = ui.Textbox({value:'2025-09-30', placeholder:'YYYY-MM-DD'});
panel.add(ui.Panel([ui.Label('Inicio'), txtStart], ui.Panel.Layout.flow('horizontal')));
panel.add(ui.Panel([ui.Label('Fin '), txtEnd], ui.Panel.Layout.flow('horizontal')));
var distritosList = DISTRI_FC.aggregate_array(DISTRI_KEY).distinct().sort().getInfo();
var selDistrito = ui.Select({items: distritosList, placeholder: 'Selecciona distrito',
                             style: {stretch:'horizontal'}});
panel.add(ui.Label('Seleccionar Provincia de Puno'));
panel.add(selDistrito);
var selMode = ui.Select({items: ['absoluto','cuantiles'], value: MODE_DEFAULT,
                         style: {stretch:'horizontal'}});
panel.add(ui.Label('Modo de clasificación'));
panel.add(selMode);

// Puntos de restauración
panel.add(ui.Label('Mostrar puntos de restauración (Solo para Putina)'));
var chkCHAL = ui.Checkbox({label: 'Chalhuani', value: false});
var chkTAM  = ui.Checkbox({label: 'Tambojarkas', value: false});
panel.add(ui.Panel([chkCHAL, chkTAM], ui.Panel.Layout.flow('horizontal')));

// Buscar por coordenada
panel.add(ui.Label('Ingresar coordenadas (Ejemplo : -69.7997 y -14.5717)'));
var txtLon = ui.Textbox({placeholder:' ', value:''});
var txtLat = ui.Textbox({placeholder:' ', value:''});
var btnGo  = ui.Button({label:'Ir', onClick: goToCoord});
panel.add(ui.Panel([ui.Label('Lon'), txtLon, ui.Label('Lat'), txtLat, btnGo],
                   ui.Panel.Layout.flow('horizontal'), {stretch:'horizontal'}));
txtLon.style().set('width','90px'); txtLon.style().set('padding','2px 6px');
txtLat.style().set('width','90px'); txtLat.style().set('padding','2px 6px');

// Botón Calcular
var btn = ui.Button('Calcular', run);
panel.add(btn);

// Descarga
var btnDlZIP = ui.Label({value:'Descargar raster clasificado (ZIP)',
  style:{backgroundColor:'#eee', padding:'8px 12px', border:'1px solid #ccc',
         borderRadius:'4px', margin:'6px 0', color:'#000'}});
btnDlZIP.style().set('shown', false);
panel.add(btnDlZIP);

// Serie NDVI
var chartTitle = ui.Label('', {fontWeight:'bold', margin:'0 0 4px 0'});
var chartPanel = ui.Panel({style:{height:'260px', stretch:'horizontal',
                                 padding:'6px', border:'1px solid #ddd'}});
panel.add(chartTitle); panel.add(chartPanel);

// Animación RGB
var animTitle = ui.Label('', {fontWeight:'bold', margin:'10px 0 4px 0'});
var animPanel = ui.Panel({style:{height:'700px', stretch:'horizontal', padding:'6px'}});
panel.add(animTitle); panel.add(animPanel);

ui.root.insert(0, panel);
Map.layers().reset();

/* ====== ESTADO GLOBAL ====== */
var g = {d0:null, d1:null, AOI:null, icSlope:null, icSeries:null,
         pointLayer:null, legendBox:null, slopeLayer:null, classLayer:null,
         classesImg:null, visSlope:null, chalLayer:null, tamLayer:null,
         estadoLabel:null, chartWidget:null, animWidget:null,
         rgbLayer:null, rgbPanel:null};

function resetState(){
  g.pointLayer = null;
  if(g.slopeLayer) Map.layers().remove(g.slopeLayer);
  if(g.classLayer) Map.layers().remove(g.classLayer);
  if(g.chalLayer) Map.layers().remove(g.chalLayer);
  if(g.tamLayer) Map.layers().remove(g.tamLayer);
  if(g.rgbLayer){Map.layers().remove(g.rgbLayer); g.rgbLayer=null;}
  g.slopeLayer=g.classLayer=g.classesImg=g.visSlope=g.chalLayer=g.tamLayer=g.estadoLabel=null;
  if(g.legendBox) ui.root.remove(g.legendBox);
  g.legendBox=null;
  if(g.chartWidget){chartPanel.widgets().remove(g.chartWidget); g.chartWidget=null;}
  if(g.animWidget){animPanel.widgets().remove(g.animWidget); g.animWidget=null;}
  g.rgbPanel=null; animTitle.setValue('');
}

/* ====== PUNTOS ====== */
function makePointLayer(fc, color, name){
  var styled = fc.style({color:color, pointSize:6, width:1});
  return ui.Map.Layer(styled, {}, name, true, 1.0);
}
function refreshPoints(){
  if(g.chalLayer){Map.layers().remove(g.chalLayer); g.chalLayer=null;}
  if(g.tamLayer){Map.layers().remove(g.tamLayer); g.tamLayer=null;}
  var base = g.AOI ? PUNTOS_FC.filterBounds(g.AOI) : PUNTOS_FC;
  if(chkCHAL.getValue()){
    var chal = base.filter(ee.Filter.stringStartsWith('Name','CHAL'));
    g.chalLayer = makePointLayer(chal,'#d73027','Chalhuani');
    Map.layers().add(g.chalLayer);
  }
  if(chkTAM.getValue()){
    var tam = base.filter(ee.Filter.stringStartsWith('Name','TAM'));
    g.tamLayer = makePointLayer(tam,'#0571b0','Tambojarkas');
    Map.layers().add(g.tamLayer);
  }
}
chkCHAL.onChange(refreshPoints); chkTAM.onChange(refreshPoints);
function classIdToText(cls){
  if(cls===null||cls===undefined) return 'Sin datos';
  var idx = Math.max(0, Math.min(4, cls));
  return CLASS_NAMES[idx] || 'Sin datos';
}

/* ====== ANIMACIÓN RGB ====== */
function buildAnimationForAOI(){
  if(!g.AOI) return;
  var years = ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'];
  var imgs = years.map(function(y){
    var base = MOSAICOS[y].clip(g.AOI).visualize(visRGB).set('label',y).set('system:index',y);
    return addAnno(base, g.AOI);
  });
  var icAnno = ee.ImageCollection.fromImages(imgs);
  var thumb = ui.Thumbnail({image:icAnno,
    params:{dimensions:1200, region:g.AOI, framesPerSecond:1},
    style:{stretch:'horizontal', margin:'6px 0'}});
  if(g.animWidget){animPanel.widgets().remove(g.animWidget); g.animWidget=null;}
  g.animWidget = thumb;
  animTitle.setValue('Animación RGB (2016–2025) — '+(selDistrito.getValue()||''));
  animPanel.widgets().add(g.animWidget);
}

/* ====== CAPA RGB POR AÑO ====== */
function showRGBYear(yearStr){
  if(!g.AOI){print('Selecciona un distrito y presiona Calcular.'); return;}
  if(g.rgbLayer){Map.layers().remove(g.rgbLayer); g.rgbLayer=null;}
  var img = MOSAICOS[yearStr];
  if(!img){print('No hay mosaico para '+yearStr); return;}
  var layerRGB = ui.Map.Layer(img.clip(g.AOI), visRGB,
                              'RGB LANDSAT '+yearStr, true, 1.0);
  if(g.classLayer){Map.layers().remove(g.classLayer); Map.layers().add(g.classLayer);}
  Map.layers().add(layerRGB); g.rgbLayer = layerRGB;
  if(g.chalLayer){Map.layers().remove(g.chalLayer); Map.layers().add(g.chalLayer);}
  if(g.tamLayer){Map.layers().remove(g.tamLayer); Map.layers().add(g.tamLayer);}
  if(g.pointLayer){Map.layers().remove(g.pointLayer); Map.layers().add(g.pointLayer);}
}
function buildRGBButtons(){
  var years = ['2016','2017','2018','2019','2020','2021','2022','2023','2024','2025'];
  var box = ui.Panel({style:{padding:'6px', backgroundColor:'rgba(255,255,255,0.9)',
                             border:'2px solid #1e90ff', width:'340px'}});
  box.add(ui.Label('SELECCIONE LA IMAGEN RGB ANUAL',
                   {fontWeight:'bold', margin:'0 0 6px 0'}));
  var row1 = ui.Panel([], ui.Panel.Layout.flow('horizontal'));
  var row2 = ui.Panel([], ui.Panel.Layout.flow('horizontal'));
  years.slice(0,5).forEach(function(y){
    row1.add(ui.Button({label:y, onClick:function(){showRGBYear(y);},
                        style:{margin:'2px', width:'62px'}}));
  });
  years.slice(5).forEach(function(y){
    row2.add(ui.Button({label:y, onClick:function(){showRGBYear(y);},
                        style:{margin:'2px', width:'62px'}}));
  });
  var hideBtn = ui.Button({label:'Ocultar RGB',
    onClick:function(){if(g.rgbLayer){Map.layers().remove(g.rgbLayer); g.rgbLayer=null;}},
    style:{margin:'4px 2px', width:'130px'}});
  box.add(row1); box.add(row2); box.add(hideBtn);
  return box;
}

/* ===================== LÓGICA PRINCIPAL ===================== */
function run(){
  Map.layers().reset(); chartTitle.setValue(''); btnDlZIP.style().set('shown',false);
  resetState();
  var d0txt = txtStart.getValue().trim(), d1txt = txtEnd.getValue().trim(),
      nomd = selDistrito.getValue(), mode = selMode.getValue();
  if(!nomd){print('Selecciona un distrito.'); return;}
  if(!d0txt||!d1txt){print('Ingresa fechas Inicio y Fin.'); return;}
  g.d0 = ee.Date(d0txt); g.d1 = ee.Date(d1txt).advance(1,'day');
  var AOI_FC = DISTRI_FC.filter(ee.Filter.eq(DISTRI_KEY, nomd));
  g.AOI = AOI_FC.geometry();
  var icRaw = ee.ImageCollection(ee.Algorithms.If(IS_STACK,
    stackToIC(ee.Image(ASSET_ID), ee.Date(FIRST_MONTH), BAND),
    ee.ImageCollection(ASSET_ID)));
  g.icSlope = prepIC(icRaw, BAND).filterDate(g.d0, g.d1).map(function(im){return im.clip(g.AOI);});
  g.icSeries = prepIC(icRaw, BAND).filterDate(SERIES_START, SERIES_END).map(function(im){return im.clip(g.AOI);});
  print('Distrito:',nomd,'| Imágenes Slope:',g.icSlope.size(),' | Imágenes Serie:',g.icSeries.size());

  // Theil-Sen
  var ic2 = addTimeBand(g.icSlope, BAND, g.d0);
  var sens = ic2.select(['t', BAND]).reduce(ee.Reducer.sensSlope());
  var slope = sens.select('slope');
  var classes = classifyRecovery(slope, g.AOI, mode).toInt();
  g.classesImg = classes; Map.centerObject(g.AOI,10);
  g.visSlope = visFromPercentiles(slope, g.AOI);
  g.classLayer = Map.addLayer(classes,{min:0,max:4,palette:CLASS_PALETTE},
                              'Clases de recuperación (0–4) — '+mode, true);
  g.slopeLayer = Map.addLayer(slope.clip(g.AOI), g.visSlope, 'Pendiente Theil–Sen', false);

  // Leyendas
  g.legendBox = ui.Panel({style:{position:'bottom-right', padding:'8px', width:'350px'}});
  var contentRight = ui.Panel();
  contentRight.add(legendCatsPanel(CLASS_NAMES, CLASS_PALETTE));
  contentRight.add(ui.Label(''));
  contentRight.add(legendSlopePanel(g.visSlope.palette, g.visSlope.min, g.visSlope.max));
  g.estadoLabel = ui.Label('Estado : —',{margin:'8px 0 0 0',fontWeight:'bold'});
  contentRight.add(ui.Label('')); contentRight.add(g.estadoLabel);

  // Área por clase
  var areaHa = ee.Image.pixelArea().divide(10000).rename('area_ha');
  var grouped = areaHa.addBands(classes).reduceRegion({
    reducer: ee.Reducer.sum().group({groupField:1, groupName:'class_id'}),
    geometry: g.AOI, scale: EXPORT_RASTER_SCALE, maxPixels:1e13, bestEffort:true});
  var groups = ee.List(grouped.get('groups'));
  var fcAreas = ee.FeatureCollection(groups.map(function(d){
    d=ee.Dictionary(d); var cid=ee.Number(d.get('class_id')).int();
    var area=ee.Number(d.get('sum')); var lab=ee.String(CLASS_NAMES_EE.get(cid));
    return ee.Feature(null,{class_id:cid,label:lab,area_ha:area});
  })).sort('class_id');
  var chartAreas = ui.Chart.feature.byFeature(fcAreas,'label',['area_ha'])
    .setChartType('ColumnChart')
    .setOptions({title:'',legend:{position:'none'},vAxis:{title:'ha',minValue:0},
                 hAxis:{title:''},bar:{groupWidth:'75%'},colors:CLASS_PALETTE});
  var chartBox = ui.Panel({style:{padding:'6px',backgroundColor:'rgba(255,255,255,0.9)',
                                  border:'2px solid #1e90ff',width:'340px'}});
  chartBox.add(ui.Label('Área por clase (ha)',{fontWeight:'bold',margin:'0 0 6px 0'}));
  chartBox.add(chartAreas);
  contentRight.add(ui.Label('')); contentRight.add(chartBox);

  // Botones RGB
  contentRight.add(ui.Label(''));
  g.rgbPanel = buildRGBButtons();
  contentRight.add(g.rgbPanel);

  // ==== NUEVOS BOTONES (SPI, VHI, GUIA DE USO) ====
  contentRight.add(ui.Label(''));
  var extraBtnPanel = ui.Panel({layout: ui.Panel.Layout.flow('horizontal'),
                               style: {margin: '0 auto 0 auto'}});
  // SPI
  var btnSPI = ui.Label({value:'Link Apps SPI',
    style:{backgroundColor:'#f0f0f0', color:'black', border:'1px solid #ccc',
           fontWeight:'bold', fontSize:'12px', padding:'6px', margin:'0 4px 0 0'}});
  btnSPI.setUrl('https://team-ramis-01.projects.earthengine.app/view/spi');
  // VHI
  var btnVHI = ui.Label({value:'link Apps VHI',
    style:{backgroundColor:'#f0f0f0', color:'black', border:'1px solid #ccc',
           fontWeight:'bold', fontSize:'12px', padding:'6px', margin:'0 4px 0 0'}});
  btnVHI.setUrl('https://team-ramis-01.projects.earthengine.app/view/vhi-sequia');
  // GUIA DE USO
  var btnGuia = ui.Label({value:'Manual de uso pdf',
    style:{backgroundColor:'#f0f0f0', color:'black', border:'1px solid #ccc',
           fontWeight:'bold', fontSize:'12px', padding:'6px', margin:'0 4px 0 0'}});
  btnGuia.setUrl('https://drive.google.com/file/d/1oxEzWAeCXejLctf94Go1pABw1qGrae8K/view?usp=sharing');

  extraBtnPanel.add(btnSPI); extraBtnPanel.add(btnVHI); extraBtnPanel.add(btnGuia);
  contentRight.add(extraBtnPanel);
  // ================================================

  // Agregar botón de toggle para panel derecho
  var isRightCollapsed = false;
  var toggleRight = ui.Button({
    label: 'Ocultar ►',
    style: {margin: '5px', fontSize: '16px'},
    onClick: function() {
      isRightCollapsed = !isRightCollapsed;
      if (isRightCollapsed) {
        contentRight.style().set('shown', false);
        g.legendBox.style().set('width', '80px');
        toggleRight.setLabel('◄ Mostrar');
      } else {
        contentRight.style().set('shown', true);
        g.legendBox.style().set('width', '350px');
        toggleRight.setLabel('Ocultar ►');
      }
    }
  });
  g.legendBox.add(toggleRight);
  g.legendBox.add(contentRight);

  ui.root.add(g.legendBox);
  makeDownloadZip(); refreshPoints(); buildAnimationForAOI(); Map.onClick(onMapClick);
}

/* ===== Serie NDVI + Theil-Sen en rango ===== */
function onMapClick(coords){
  if(!g.icSeries||!g.d0||!g.d1){print('Primero selecciona distrito/fechas y presiona Calcular.'); return;}
  var pt = ee.Geometry.Point([coords.lon, coords.lat]);
  if(g.pointLayer) Map.layers().remove(g.pointLayer);
  g.pointLayer = crossLayer(pt,60,'cyan'); Map.layers().add(g.pointLayer);
  var icAll = g.icSeries.filterDate(SERIES_START,SERIES_END);
  var fcAll = icAll.map(function(im){
    var nd = im.reduceRegion({reducer:ee.Reducer.mean(),geometry:pt,scale:CHART_SCALE,bestEffort:true}).get(BAND);
    var date = im.date(); var date_ms = date.millis();
    var tSub = date.difference(g.d0,'year');
    return ee.Feature(null,{date_ms:date_ms, ndvi:nd, tSub:tSub});
  }).filter(ee.Filter.notNull(['ndvi']));
  var ms0 = g.d0.millis(), ms1 = g.d1.millis();
  var fcSub = fcAll.filter(ee.Filter.gte('date_ms',ms0)).filter(ee.Filter.lt('date_ms',ms1));
  var npts = fcSub.size();
  var tsDict = ee.Dictionary(ee.Algorithms.If(npts.gt(1),
    fcSub.reduceColumns({reducer:ee.Reducer.sensSlope(), selectors:['tSub','ndvi']}),
    ee.Dictionary({'slope':null,'intercept':null})));
  var tsSlope = ee.Number(tsDict.get('slope'));
  var hasIntercept = tsDict.contains('intercept');
  var tsIntercept = ee.Number(ee.Algorithms.If(hasIntercept, tsDict.get('intercept'),
    ee.Number(fcSub.aggregate_mean('ndvi')).subtract(tsSlope.multiply(ee.Number(fcSub.aggregate_mean('tSub'))))));
  var fcForChart = fcAll.map(function(f){
    var dms = ee.Number(f.get('date_ms'));
    var inWin = dms.gte(ms0).and(dms.lt(ms1));
    var yhat = tsSlope.multiply(ee.Number(f.get('tSub'))).add(tsIntercept);
    var yPlot = ee.Number(ee.Algorithms.If(inWin,yhat,null));
    return f.set('ts_fit',yPlot);
  }).sort('date_ms');
  ee.Dictionary({'g':ee.Date(SERIES_START).format('yyyy-MM')
                .cat(' → ').cat(ee.Date(SERIES_END).advance(-1,'day').format('yyyy-MM')),
                'r':ee.Date(g.d0).format('yyyy-MM-dd')
                .cat(' → ').cat(ee.Date(g.d1).advance(-1,'day').format('yyyy-MM-dd'))})
    .evaluate(function(tt){
      var chart = ui.Chart.feature.byFeature(fcForChart,'date_ms',['ndvi','ts_fit'])
        .setChartType('LineChart')
        .setOptions({title:'NDVI en ('+coords.lon.toFixed(4)+', '+coords.lat.toFixed(4)+')',
                     legend:{position:'none'}, hAxis:{title:'Fecha',format:'yyyy'},
                     vAxis:{title:'NDVI',viewWindowMode:'pretty'}, pointSize:3, lineWidth:1,
                     series:{0:{type:'scatter',pointSize:3,lineWidth:1},
                             1:{type:'line',lineWidth:3,color:'red',enableInteractivity:false}}});
      if(g.chartWidget){chartPanel.widgets().remove(g.chartWidget); g.chartWidget=null;}
      g.chartWidget = chart; chartTitle.setValue('Serie de tiempo NDVI LANDSAT/SENTINEL');
      chartPanel.widgets().add(g.chartWidget);
    });
  if(g.classesImg && g.estadoLabel){
    var sample = g.classesImg.reduceRegion({reducer:ee.Reducer.first(),geometry:pt,
                                            scale:EXPORT_RASTER_SCALE,bestEffort:true}).get('class_id');
    sample.evaluate(function(v){g.estadoLabel.setValue('Estado : '+classIdToText(v));});
  }
  print('TS en rango ',g.d0.format('yyyy-MM-dd'),' → ',g.d1.format('yyyy-MM-dd'),
        ' | slope (NDVI/año)=',tsSlope,' | intercept=',tsIntercept,' | n=',npts);
}

/* ===== Ir a coordenada ===== */
function goToCoord(){
  var lon = parseFloat((txtLon.getValue()||'').toString().replace(',','.'));
  var lat = parseFloat((txtLat.getValue()||'').toString().replace(',','.'));
  if(isNaN(lon)||isNaN(lat)||lon<-180||lon>180||lat<-90||lat>90){
    print('Ingresa valores válidos: lon ∈ [-180,180], lat ∈ [-90,90].'); return;
  }
  if(!g.icSeries||!g.d0||!g.d1){print('Primero selecciona distrito/fechas y presiona Calcular.'); return;}
  var pt = ee.Geometry.Point([lon, lat]); Map.centerObject(pt,14);
  onMapClick({lon:lon, lat:lat});
}

/* ===== DESCARGA ZIP ===== */
function makeDownloadZip(){
  if(!g.AOI||!g.classesImg){btnDlZIP.style().set('shown',false); return;}
  var proj = g.classesImg.projection().atScale(EXPORT_RASTER_SCALE);
  var classRaster = g.classesImg.toInt().reproject(proj).rename('class_id');
  var baseName = selDistrito.getValue().replace(/\s+/g,'_');
  var nameWithDates = ee.String(baseName)
    .cat('_').cat(ee.Date(g.d0).format('yyyyMMdd'))
    .cat('_').cat(ee.Date(g.d1).advance(-1,'day').format('yyyyMMdd'));
  nameWithDates.evaluate(function(nm){
    var urlZIP = classRaster.getDownloadURL({name:nm||baseName, scale:EXPORT_RASTER_SCALE,
                                             region:g.AOI, format:'ZIPPED_GEO_TIFF', filePerBand:false});
    btnDlZIP.setValue('Descargar: '+(nm||baseName)+'.zip');
    btnDlZIP.setUrl(urlZIP); btnDlZIP.style().set('shown',true);
  });
}
