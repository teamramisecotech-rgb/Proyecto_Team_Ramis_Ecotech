/**************************************************************
 SPI (CDF empírica → Φ⁻¹) desde CHIRPS mensual 1981–2025-08
 - Referencia SPI: 1991–2020
 - Series: SPI-1, 3, 6, 12 (promedio del DISTRITO)
 - Gráfico: 2021-01 a 2025-08
 - UI: Selección de DISTRITO y series SPI (panel sobre el mapa)
 - Mapa: SPI-12 del AÑO/MES seleccionados, recortado al distrito
**************************************************************/

/* ===================== MAPA de relieve fijo ===================== */
var map = ui.Map();
ui.root.widgets().reset([map]);                 // Solo el mapa
map.setOptions('TERRAIN');                      // Relieve Google
map.setControlVisibility({mapTypeControl:false});

/* ===================== Parámetros ===================== */
var CHIRPS_ASSET = 'projects/team-ramis-01/assets/chirps_v3_mensual_1981_01_2025_08_Puno';

var REF_START  = '1991-01-01';
var REF_END    = '2020-12-31';
var VIEW_START = '2021-01-01';
var VIEW_END   = '2025-08-31';

var REDUCE_SCALE = 5000;  // series
var DRAW_SCALE   = 5000;  // mapa

// Paleta SPI (seco → húmedo)
var SPI_PALETTE = ['#7f2704','#fdd49e','#ffffe5','#d0e1f2','#2166ac'];
var SPI_MIN = -2.5, SPI_MAX = 2.5;

/* ===================== Distritos / AOI ===================== */
var DIST_FC    = ee.FeatureCollection('projects/team-ramis-05/assets/DISTRITOS_PUNO'); // campo: DISTRITO
var DIST_FIELD = 'NOMBDIST';
var PICOTANI_FC = ee.FeatureCollection('projects/team-ramis-01/assets/cc_picotani_WGS84');

/* ===================== Contornos arriba ===================== */
var outlineStyle = {color:'#007BFF', width:2, fillColor:'00000000'};
var outlineImg   = DIST_FC.style(outlineStyle);
var outlineLayer = ui.Map.Layer(outlineImg, {}, 'Distritos (contorno)', true);
map.add(outlineLayer);

var picotaniStyle = {color:'#000000', width:2, fillColor:'00000000'};
var picotaniImg   = PICOTANI_FC.style(picotaniStyle);
var picotaniLayer = ui.Map.Layer(picotaniImg, {}, 'AOI Picotani (contorno)', true);
map.add(picotaniLayer);

function bringOutlinesToFront(){
  map.layers().remove(outlineLayer);
  map.layers().remove(picotaniLayer);
  map.layers().add(outlineLayer);
  map.layers().add(picotaniLayer);
}

/* ===================== Utilidades ===================== */
function getAOIfromName(name){
  var feat = DIST_FC.filter(ee.Filter.eq(DIST_FIELD, name)).first();
  return ee.Feature(feat).geometry();
}
function pad2(n){ n = ee.Number(n); return ee.String(n.format('%02d')); }

/* ===================== 1) Datos mensuales CHIRPS ===================== */
var CH_M   = ee.Image(CHIRPS_ASSET).toFloat();
var nBands = CH_M.bandNames().size();
var t0     = ee.Date('1981-01-01');

var monthlyIC = ee.ImageCollection(
  ee.List.sequence(0, nBands.subtract(1)).map(function(i){
    i = ee.Number(i);
    var date = t0.advance(i, 'month');
    return CH_M.select([i]).rename('precip')
      .set('system:time_start', date.millis())
      .set('year',  date.get('year'))
      .set('month', date.get('month'));
  })
);

/* ===================== 2) SPI (funciones) ===================== */
function rollingSum(ic, k){
  return ic.map(function(img){
    var end  = ee.Date(img.get('system:time_start'));
    var beg  = end.advance(1 - k, 'month');
    var win  = ic.filterDate(beg, end.advance(1,'month'));
    var sum  = win.sum().rename('sum');
    var cnt  = win.count();
    sum = sum.updateMask(cnt.gte(k));
    return sum
      .set('system:time_start', end.millis())
      .set('month', img.get('month'))
      .set('year',  img.get('year'));
  });
}
function horner(q, coeffs){
  var res = ee.Image(coeffs[0]);
  for (var i = 1; i < coeffs.length; i++){ res = res.multiply(q).add(coeffs[i]); }
  return res;
}
function invNorm(p){
  var x = ee.Image(p).clamp(1e-6, 1 - 1e-6);
  var a = [-39.69683028665376,220.9460984245205,-275.9285104469687,138.357751867269,-30.66479806614716,2.506628277459239];
  var b = [-54.47609879822406,161.5858368580409,-155.6989798598866,66.80131188771972,-13.28068155288572];
  var c = [-0.007784894002430293,-0.3223964580411365,-2.400758277161838,-2.549732539343734,4.374664141464968,2.938163982698783];
  var d = [0.007784695709041462,0.3224671290700398,2.445134137142996,3.754408661907416];
  var plow = 0.02425, phigh = 1 - plow;

  var ql  = x.log().multiply(-2).sqrt();
  var zl  = horner(ql, [c[0],c[1],c[2],c[3],c[4],c[5]]).divide(horner(ql, [d[0],d[1],d[2],d[3],1])).multiply(-1);
  var qh  = ee.Image(1).subtract(x).log().multiply(-2).sqrt();
  var zh  = horner(qh, [c[0],c[1],c[2],c[3],c[4],c[5]]).divide(horner(qh, [d[0],d[1],d[2],d[3],1]));
  var qc  = x.subtract(0.5);
  var r   = qc.multiply(qc);
  var zc  = horner(r, [a[0],a[1],a[2],a[3],a[4],a[5]]).multiply(qc).divide(horner(r, [b[0],b[1],b[2],b[3],b[4],1]));
  return ee.Image(0).where(x.lt(plow), zl).where(x.gte(plow).and(x.lte(phigh)), zc).where(x.gt(phigh), zh);
}
function makeSPI_empirical(icMonthly, k, refStart, refEnd){
  var acc = rollingSum(icMonthly, k).select('sum');
  var ref = acc.filterDate(refStart, refEnd);
  var monthsNum = ee.List.sequence(1, 12);
  var monthsStr = monthsNum.map(function(m){ return ee.Number(m).format('%02d'); });

  var arrDict = ee.Dictionary.fromLists(
    monthsStr,
    monthsNum.map(function(m){
      var refM = ref.filter(ee.Filter.eq('month', m)).sort('system:time_start');
      return refM.toBands().toArray();
    })
  );
  var nDict = ee.Dictionary.fromLists(
    monthsStr,
    monthsNum.map(function(m){ return ref.filter(ee.Filter.eq('month', m)).size(); })
  );

  return acc.map(function(img){
    var key  = ee.Number(img.get('month')).format('%02d');
    var arr  = ee.Image(arrDict.get(key));
    var n    = ee.Number(nDict.get(key));
    var x    = img;

    var count = arr.lte(x).arrayReduce(ee.Reducer.sum(), [0]).arrayGet([0]);
    var p     = ee.Image(count).add(0.44).divide(ee.Image.constant(n).add(0.12));
    var z     = invNorm(p).rename('SPI_' + k);
    return z.copyProperties(img, ['system:time_start','month','year']);
  });
}

/* ===================== 3) SPI k=1,3,6,12 ===================== */
var SPI1  = makeSPI_empirical(monthlyIC, 1,  REF_START, REF_END);
var SPI3  = makeSPI_empirical(monthlyIC, 3,  REF_START, REF_END);
var SPI6  = makeSPI_empirical(monthlyIC, 6,  REF_START, REF_END);
var SPI12 = makeSPI_empirical(monthlyIC, 12, REF_START, REF_END);

function joinByTime(icA, icB){
  var join = ee.Join.inner();
  var on   = ee.Filter.equals({leftField:'system:time_start', rightField:'system:time_start'});
  return ee.ImageCollection(join.apply(icA, icB, on).map(function(f){
    f = ee.Feature(f);
    var a = ee.Image(f.get('primary'));
    var b = ee.Image(f.get('secondary'));
    return a.addBands(b).copyProperties(a, ['system:time_start','month','year']);
  }));
}
var spi_1_3   = joinByTime(SPI1,  SPI3);
var spi_1_3_6 = joinByTime(spi_1_3, SPI6);
var spiStack  = joinByTime(spi_1_3_6, SPI12); // SPI_1,SPI_3,SPI_6,SPI_12

/* ===================== 4) Vista inicial ===================== */
map.centerObject(PICOTANI_FC, 8);
bringOutlinesToFront();

/* ===================== 5) UI sobre el MAPA ===================== */
// Ventana de gráfico
var chartWindow = ui.Panel({
  style:{ position:'top-right', width:'460px', padding:'6px',
          backgroundColor:'rgba(255,255,255,0.95)' }
});
map.add(chartWindow);
function setChartInWindow(chart){ chartWindow.clear(); chartWindow.add(chart); }

// Ancho consistente
var W = 210;

// Selects
var selDist   = ui.Select({placeholder:'Cargando distritos…', style:{width: W + 'px'}});
var cb1  = ui.Checkbox({label:'SPI-1',  value:false});
var cb3  = ui.Checkbox({label:'SPI-3',  value:false});
var cb6  = ui.Checkbox({label:'SPI-6',  value:false});
var cb12 = ui.Checkbox({label:'SPI-12', value:true});
var btnShow = ui.Button({label:'Mostrar serie', style:{width: W + 'px'}});

// NUEVO: Año/Mes para el MAPA SPI-12
var selYearMap  = ui.Select({placeholder:'Año (SPI-12 mapa)',  style:{width: W + 'px'}});
var selMonthMap = ui.Select({placeholder:'Mes (SPI-12 mapa)',   style:{width: W + 'px'}});

// Panel izquierdo
var leftPanel = ui.Panel({
  widgets:[
    ui.Label('Índice de Precipitación Estandarizado (SPI)', {fontWeight:'bold', fontSize:'19px',color: 'green', textAlign: 'center'}),
    ui.Label('Distritos de Puno:', {margin:'8px 0 2px 0'}), selDist,
    ui.Label('Series SPI: 1-3-6-12:', {margin:'8px 0 2px 0'}),
    ui.Panel([cb1, cb3, cb6, cb12], ui.Panel.Layout.flow('horizontal'), {margin:'4px 0 6px 0'}),
    btnShow,
    ui.Label('Mapa SPI-12:', {margin:'10px 0 2px 0'}),
    selYearMap, selMonthMap
  ],
  style:{
    position:'top-left',
    width:'230px',
    padding:'8px',
    backgroundColor:'rgba(255,255,255,0.95)',
    border:'1px solid #ddd'
  }
});
map.add(leftPanel);

/* ====== Poblar Año/Mes disponibles desde SPI12 ====== */
var yearsAvailable = ee.List(SPI12.aggregate_array('year')).distinct().sort();
function loadMonthsForYear(yStr){
  var yNum = ee.Number.parse(yStr);
  var months = ee.List(SPI12.filter(ee.Filter.eq('year', yNum))
                  .aggregate_array('month')).distinct().sort();
  months.evaluate(function(ms){
    var items = (ms || []).map(function(m){ return (m < 10 ? '0'+m : ''+m); });
    selMonthMap.items().reset(items);
    if (items.length){ selMonthMap.setValue(items[items.length-1], true); } // último mes disponible
    // Si ya hay distrito seleccionado, actualiza mapa
    var name = selDist.getValue(); if (name) updateMapSPI12(name);
  });
}
yearsAvailable.evaluate(function(ys){
  var items = (ys || []).map(function(y){ return String(y); });
  selYearMap.items().reset(items);
  if (items.length){ selYearMap.setValue(items[items.length-1], true); } // último año
  if (items.length){ loadMonthsForYear(selYearMap.getValue()); }
});
selYearMap.onChange(loadMonthsForYear);

/* ===================== 6) Capa dinámica SPI-12 ===================== */
var spi12Layer = null;

function updateMapSPI12(name){
  var geom = getAOIfromName(name);
  var y = selYearMap.getValue(); var mStr = selMonthMap.getValue();
  if (!y || !mStr){ return; }
  var m = parseInt(mStr, 10);

  var col = SPI12.filter(ee.Filter.eq('year', ee.Number.parse(y)))
                 .filter(ee.Filter.eq('month', m));

  col.size().evaluate(function(n){
    if (n && n > 0){
      var img = ee.Image(col.first()).select('SPI_12').clip(geom)
                  .reproject({crs:'EPSG:4326', scale: DRAW_SCALE});
      if (spi12Layer) map.layers().remove(spi12Layer);
      spi12Layer = ui.Map.Layer(
        img, {min: SPI_MIN, max: SPI_MAX, palette: SPI_PALETTE},
        'SPI-12 ' + y + '-' + mStr + ' — ' + name, true
      );
      map.add(spi12Layer);
      bringOutlinesToFront();
    } else {
      if (spi12Layer) map.layers().remove(spi12Layer);
      print('No hay SPI-12 para ' + y + '-' + mStr + ' en ' + name);
    }
  });
}

/* ===================== 7) Gráfico y eventos ===================== */
function buildSPIChartForDistrict(name){
  if (!name){
    setChartInWindow(ui.Label('Elige un distrito.', {color:'red'}));
    return;
  }
  var selected = [];
  if (cb1.getValue())  selected.push('SPI_1');
  if (cb3.getValue())  selected.push('SPI_3');
  if (cb6.getValue())  selected.push('SPI_6');
  if (cb12.getValue()) selected.push('SPI_12');
  if (selected.length === 0){
    setChartInWindow(ui.Label('Selecciona al menos una serie SPI.', {color:'red'}));
    return;
  }

  var geom = getAOIfromName(name);
  var icView = spiStack.filterDate(VIEW_START, VIEW_END).select(selected);

  var chart = ui.Chart.image.series({
    imageCollection: icView, region: geom, reducer: ee.Reducer.mean(),
    scale: REDUCE_SCALE, xProperty: 'system:time_start'
  })
  .setChartType('LineChart')
  .setOptions({
    title: 'SPI promedio — ' + name + '   (' + selected.join(', ').replace(/_/g,'-') + ')',
    hAxis: {title: 'Fecha'},
    vAxis: {title: 'SPI', viewWindow:{min:-3, max:3}},
    legend: {position:'top'},
    series: {0:{lineWidth:2},1:{lineWidth:2},2:{lineWidth:2},3:{lineWidth:2}}
  });

  setChartInWindow(chart);

  // Actualiza el mapa SPI-12 con el año/mes seleccionados
  updateMapSPI12(name);

  // Enfocar distrito
  map.centerObject(geom, 9);
}

// cambios de UI
selDist.onChange(function(name){
  buildSPIChartForDistrict(name);
});
btnShow.onClick(function(){
  var name = selDist.getValue();
  buildSPIChartForDistrict(name);
});
selMonthMap.onChange(function(){
  var name = selDist.getValue();
  if (name) updateMapSPI12(name);
});

/* ===================== 8) Cargar distritos + estado inicial ===================== */
ee.List(DIST_FC.aggregate_array(DIST_FIELD)).distinct().sort().evaluate(function(list){
  selDist.items().reset(list);
  if (list && list.indexOf('PUTINA') > -1){
    selDist.setValue('PUTINA', true); // dispara onChange → gráfico + mapa
  }
});

// Mantener contornos arriba
bringOutlinesToFront();
