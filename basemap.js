/* =====================================================================
   ПОДЛОЖКА: своя векторная карта (данные OpenFreeMap / OpenStreetMap)
   Ключ не нужен. Цвета ниже — меняйте как хотите.
   Подписи берутся на русском (name:ru), если русского нет — местное имя.
   ===================================================================== */
window.BASEMAP_STYLE = (function(){
  var C = {
    land:  '#3E3E42',  // суша
    water: '#222226',  // вода
    park:  '#424246',  // парки
    wood:  '#3A3A3E',  // леса, поля
    resid: '#404044',  // жилая застройка
    road:  '#56565B',  // мелкие улицы
    major: '#606065',  // крупные улицы
    motor: '#6A6A6F',  // магистрали
    rail:  '#4E4E53',  // железные дороги
    bound: '#6A6A70',  // границы
    label: '#B4B4BA',  // подписи городов
    labelDim: '#8E8E95', // подписи районов, улиц, воды
    halo:  '#2C2C30'   // обводка подписей
  };
  var RU = ['coalesce',['get','name:ru'],['get','name']];
  function line(id, cls, color, w, minz){ return {id:id,type:'line',source:'omt','source-layer':'transportation',minzoom:minz||0,
    filter:['in',['get','class'],['literal',cls]], layout:{'line-cap':'round','line-join':'round'},
    paint:{'line-color':color,'line-width':['interpolate',['exponential',1.5],['zoom'],8,w[0],12,w[1],16,w[2]]}}; }
  return { version:8, glyphs:'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf',
    sources:{ omt:{type:'vector',url:'https://tiles.openfreemap.org/planet'} },
    layers:[
      {id:'bg',type:'background',paint:{'background-color':C.land}},
      {id:'wood',type:'fill',source:'omt','source-layer':'landcover',filter:['in',['get','class'],['literal',['wood','forest','grass','farmland']]],paint:{'fill-color':C.wood,'fill-opacity':.8}},
      {id:'resid',type:'fill',source:'omt','source-layer':'landuse',filter:['in',['get','class'],['literal',['residential','suburb','neighbourhood']]],paint:{'fill-color':C.resid,'fill-opacity':.7}},
      {id:'park',type:'fill',source:'omt','source-layer':'park',paint:{'fill-color':C.park}},
      {id:'water',type:'fill',source:'omt','source-layer':'water',paint:{'fill-color':C.water}},
      {id:'waterway',type:'line',source:'omt','source-layer':'waterway',paint:{'line-color':C.water,'line-width':['interpolate',['linear'],['zoom'],8,.6,14,2.5]}},
      {id:'bld',type:'fill',source:'omt','source-layer':'building',minzoom:14,paint:{'fill-color':'#47474C','fill-opacity':.6}},
      line('minor',['minor','service','tertiary'],C.road,[.2,.5,3],11),
      line('major',['primary','secondary','trunk'],C.major,[.4,1,5],8),
      line('motor',['motorway'],C.motor,[.6,1.4,6],6),
      {id:'rail',type:'line',source:'omt','source-layer':'transportation',minzoom:10,filter:['==',['get','class'],'rail'],paint:{'line-color':C.rail,'line-width':1,'line-dasharray':[3,3]}},
      {id:'bound',type:'line',source:'omt','source-layer':'boundary',filter:['<=',['get','admin_level'],4],paint:{'line-color':C.bound,'line-width':1,'line-dasharray':[4,2,1,2]}},
      {id:'water-name',type:'symbol',source:'omt','source-layer':'water_name',layout:{'text-field':RU,'text-font':['Noto Sans Italic'],'text-size':13,'text-max-width':6},paint:{'text-color':C.labelDim,'text-halo-color':C.halo,'text-halo-width':1}},
      {id:'road-name',type:'symbol',source:'omt','source-layer':'transportation_name',minzoom:14,filter:['in',['get','class'],['literal',['primary','secondary','tertiary','trunk']]],layout:{'symbol-placement':'line','text-field':RU,'text-font':['Noto Sans Regular'],'text-size':11},paint:{'text-color':C.labelDim,'text-halo-color':C.halo,'text-halo-width':1}},
      {id:'place-small',type:'symbol',source:'omt','source-layer':'place',minzoom:13,filter:['in',['get','class'],['literal',['suburb','quarter','neighbourhood','village','hamlet']]],layout:{'text-field':RU,'text-font':['Noto Sans Regular'],'text-size':11,'text-max-width':7},paint:{'text-color':C.labelDim,'text-halo-color':C.halo,'text-halo-width':1}},
      {id:'place-town',type:'symbol',source:'omt','source-layer':'place',minzoom:8,filter:['==',['get','class'],'town'],layout:{'text-field':RU,'text-font':['Noto Sans Regular'],'text-size':13},paint:{'text-color':C.label,'text-halo-color':C.halo,'text-halo-width':1.2}},
      {id:'place-city',type:'symbol',source:'omt','source-layer':'place',filter:['==',['get','class'],'city'],layout:{'text-field':RU,'text-font':['Noto Sans Bold'],'text-size':['interpolate',['linear'],['zoom'],6,13,12,18]},paint:{'text-color':C.label,'text-halo-color':C.halo,'text-halo-width':1.5}}
    ]};
})();
