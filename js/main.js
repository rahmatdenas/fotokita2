'use strict';

// ==========================================
// 1. KONSTANTA & VARIABEL GLOBAL
// ==========================================
const WDQS_API_URL            = 'https://query.wikidata.org/sparql';
const COMMONS_WIKI_URL_PREF   = 'https://commons.wikimedia.org/wiki/';
const OSM_LAYER_URL           = 'https://tile.openstreetmap.org/{z}/{x}/{y}.png';
const OSM_LAYER_ATTRIBUTION   = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>';
const CARTO_LAYER_URL         = 'https://cartodb-basemaps-{s}.global.ssl.fastly.net/rastertiles/voyager_labels_under/{z}/{x}/{y}{r}.png';
const CARTO_LAYER_ATTRIBUTION = 'Base map &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a> (data), <a href="https://carto.com/">CARTO</a> (style)';
const TILE_LAYER_MAX_ZOOM     = 19;

const SPARQL_RESIDENCE_QUERY = `
SELECT ?location ?locationLabel ?pointInTime ?ptPrecision (SAMPLE(?coord_raw) AS ?coord) (SAMPLE(?image_raw) AS ?image) WHERE {
  # Fokus pada butir tokoh Q561682
  wd:Q561682 p:P551 ?residenceStatement .
  ?residenceStatement ps:P551 ?location .
  
  # WAJIB memiliki atribut "pada waktu" (P585)
  ?residenceStatement pqv:P585 ?ptNode .
  ?ptNode wikibase:timeValue ?pointInTime ;
          wikibase:timePrecision ?ptPrecision .
          
  OPTIONAL { ?location wdt:P625 ?coord_raw . }
  OPTIONAL { ?location wdt:P18 ?image_raw . }
  
  SERVICE wikibase:label { bd:serviceParam wikibase:language "id,en". }
}
GROUP BY ?location ?locationLabel ?pointInTime ?ptPrecision
ORDER BY ?pointInTime
`;

var Map;
var TimelineRecords = [];

// Variabel Global untuk Autoplay
let isPlaying = false;
let playInterval = null;
let bgAudio = null;
let scrollTimeout = null;


// ==========================================
// 2. INISIALISASI APLIKASI UTAMA
// ==========================================
window.addEventListener('load', init);

function init() {
  initMap();
  loadPrimaryData();
}

function initMap() {
  Map = new L.map('map', { 
    minZoom: 2 
  }).setView([-0.789, 113.921], 5);

  let cartoLayer = new L.tileLayer(CARTO_LAYER_URL, {
    attribution : CARTO_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  }).addTo(Map);

  let osmLayer = new L.tileLayer(OSM_LAYER_URL, {
    attribution : OSM_LAYER_ATTRIBUTION,
    maxZoom     : TILE_LAYER_MAX_ZOOM,
  });

  let baseMaps = {
    'CARTO Voyager'       : cartoLayer,
    'OpenStreetMap Carto' : osmLayer,
  };
  
  L.control.layers(baseMaps, null, {position: 'topleft'}).addTo(Map);
}


// ==========================================
// 3. PENGAMBILAN & PEMROSESAN DATA
// ==========================================
function queryWdqsThenProcess(query, processEachResult, postprocessCallback) {
  let promise = new Promise((resolve, reject) => {
    let xhr = new XMLHttpRequest();
    xhr.onreadystatechange = function() {
      if (xhr.readyState !== xhr.DONE) return;
      if (xhr.status === 200) {
        resolve(JSON.parse(xhr.responseText));
      } else {
        reject(xhr.status);
      }
    };
    xhr.open('POST', WDQS_API_URL, true);
    xhr.overrideMimeType('text/plain');
    xhr.setRequestHeader('Content-type', 'application/x-www-form-urlencoded');
    xhr.send('format=json&query=' + encodeURIComponent(query));
  });

  promise = promise.then(data => {
    if (data.results && data.results.bindings) {
      data.results.bindings.forEach(processEachResult);
    }
  });

  if (postprocessCallback) promise = promise.then(postprocessCallback);
  return promise;
}

function loadPrimaryData() {
  fetch('data.json')
    .then(response => {
      if (!response.ok) throw new Error('Network response was not ok');
      return response.json();
    })
    .then(data => {
      data.forEach(result => {
        let record = {
          locationName: result.locationLabel,
          rawTime: result.pointInTime,
          formattedDate: formatWikidataDate(result.pointInTime, result.ptPrecision)
        };

        if (result.coord) {
          let wktBits = result.coord.split(/\(|\)| /); 
          record.lon = parseFloat(wktBits[1]);
          record.lat = parseFloat(wktBits[2]);
        }
        TimelineRecords.push(record);
      });

      TimelineRecords.sort((a, b) => a.rawTime.localeCompare(b.rawTime));
      renderMapAndPanel();
    })
    .catch(error => {
      console.error('Terjadi kesalahan saat memuat JSON lokal:', error);
    });
}


// ==========================================
// 4. LOGIKA PANEL & AUTOPLAY
// ==========================================
function hentikanPlay() {
  isPlaying = false; 
  if (playInterval !== null) {
    clearInterval(playInterval);
    playInterval = null;
  }
  if (bgAudio && !bgAudio.paused) {
    let playPromise = bgAudio.play();
    if (playPromise !== undefined) {
      playPromise.then(_ => {
        bgAudio.pause();
      }).catch(error => {});
    } else {
      bgAudio.pause();
    }
  }

  let playBtn = document.getElementById('play-btn');
  if (playBtn) {
    playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>';
  }
}

function dapatkanOpsiBounds(denganDurasi = false) {
  let apakahMobile = window.innerWidth <= 800;
  let opsi = apakahMobile 
    ? { paddingTopLeft: [40, 40], paddingBottomRight: [40, (window.innerHeight / 2) + 40] }
    : { padding: [40, 40] };
  if (denganDurasi) opsi.duration = 1.5;
  return opsi;
}

function renderMapAndPanel() {
  let detailsContainer = document.getElementById('details');
  let markerBounds = [];
  
  let allHtml = `
    <div class="timeline-item" id="item--1" data-index="-1">
      <h2 class="timeline-date" style="cursor: pointer;" title="Tampilkan Semua Peta">Pengantar</h2>
      <div class="location-desc">
        <p style="margin-top:0px;">Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed do eiusmod tempor incididunt ut labore et dolore magna aliqua. Nanti bisa diisi dengan biografi dan foto di sini secara manual.</p>
      </div>
    </div>
  `; 
  
  let indexAktif = '-1';
  hentikanPlay();

  if (!bgAudio) {
    bgAudio = document.createElement('audio');
    bgAudio.id = 'bg-musik';
    bgAudio.src = 'lagu-sejarah.mp3'; 
    bgAudio.loop = true; 
    document.body.appendChild(bgAudio);
  }

  function gulirkanPanelLewatKode(posisiTarget) {
    if (Math.abs(detailsContainer.scrollTop - posisiTarget) < 4) {
      detailsContainer.classList.remove('sedang-auto-scroll');
      return;
    }
    if (scrollTimeout) clearTimeout(scrollTimeout);
    
    detailsContainer.classList.add('sedang-auto-scroll');
    detailsContainer.scrollTo({ top: posisiTarget, behavior: 'smooth' });
  }

  function jalankanAnimasiSatuLangkah() {
    let curIdx = parseInt(indexAktif === '-1' ? '-1' : indexAktif);
    let nextIdx = curIdx + 1;

    if (nextIdx >= TimelineRecords.length) {
      hentikanPlay();
      indexAktif = '-1'; 
      Map.closePopup(); 
      if (markerBounds.length > 0) {
        Map.flyToBounds(markerBounds, dapatkanOpsiBounds(true)); 
      }
      gulirkanPanelLewatKode(0);
      return; 
    }    
    
    let targetRecord = TimelineRecords[nextIdx];
    if (targetRecord && targetRecord.marker) {
      targetRecord.marker.openPopup();
      fokusKeMarker(targetRecord.marker.getLatLng(), false); 
      indexAktif = nextIdx.toString();
      
      let targetItem = document.getElementById(`item-${nextIdx}`);
      if (targetItem) {
        let scrollPos = targetItem.offsetTop;
        if (scrollPos < 0) scrollPos = 0;
        gulirkanPanelLewatKode(scrollPos);
      }
    }
  }

  let playBtn = document.getElementById('play-btn');
  if (playBtn) {
    let newPlayBtn = playBtn.cloneNode(true);
    playBtn.parentNode.replaceChild(newPlayBtn, playBtn);
    playBtn = newPlayBtn;
    
    playBtn.addEventListener('click', function(e) {
      e.stopPropagation();
      
      if (isPlaying) {
        hentikanPlay(); 
      } else {
        let curIdx = parseInt(indexAktif === '-1' ? '-1' : indexAktif);
        let apakahDiUjung = curIdx >= TimelineRecords.length - 1;

        isPlaying = true;
        playBtn.innerHTML = '<svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
        
        if (bgAudio) {
          bgAudio.play().catch(function(error) {
            console.log("Browser menahan pemutaran otomatis lagu: ", error); 
          });
        }

        if (apakahDiUjung) {
          indexAktif = '-1'; 
          Map.closePopup(); 
          if (markerBounds.length > 0) {
            Map.flyToBounds(markerBounds, dapatkanOpsiBounds(true)); 
          }
          gulirkanPanelLewatKode(0);
        } else {
          jalankanAnimasiSatuLangkah(); 
        }
        
        clearInterval(playInterval); 
        playInterval = setInterval(jalankanAnimasiSatuLangkah, 3000); 
      }
    });
  }

  // Rakit HTML Panel
  TimelineRecords.forEach((record, index) => {
    let gambarPanel = `Fotokita/panel-${index}.jpg`;
    allHtml += `
      <div class="timeline-item" id="item-${index}" data-index="${index}">
        <h2 class="timeline-date" style="cursor: pointer;" title="Tampilkan di Peta">${record.formattedDate}</h2>
        <figure class="timeline-figure">
          <img src="${gambarPanel}" alt="${record.locationName}" onerror="this.style.display='none'">
        </figure>
        <div class="location-desc">
          <p class="location-name"><strong>${record.locationName}</strong></p>
          ${record.lat && record.lon ? `<p class="coord-text">Koordinat: ${record.lat.toFixed(4)}, ${record.lon.toFixed(4)}</p>` : ''}
        </div>
      </div>
    `;
  });
  detailsContainer.innerHTML = allHtml;

  // Interaksi Klik Marker
  TimelineRecords.forEach((record, index) => {
    if (record.lat && record.lon) {
      let marker = L.marker([record.lat, record.lon]).addTo(Map);
      record.marker = marker; 
      markerBounds.push([record.lat, record.lon]);
      
      let gambarPopup = `Fotokita/popup-${index}.jpg`;
      let popupContent = `
        <div class="custom-popup">
          <img src="${gambarPopup}" alt="${record.locationName}" onerror="this.style.display='none'"><br>
          <strong class="popup-title">${record.locationName}</strong>
          <span class="popup-date">${record.formattedDate}</span>
        </div>
      `;
      marker.bindPopup(popupContent, { autoPan: false, minWidth: 160, maxWidth: 160 });
      
      marker.on('click', function() {
        hentikanPlay(); 
        fokusKeMarker(marker.getLatLng(), true, 0.3, true); 
        
        let indexStr = index.toString();
        indexAktif = indexStr; 
        if (scrollTimeout) clearTimeout(scrollTimeout);
        detailsContainer.classList.add('sedang-auto-scroll');

        let targetItem = document.getElementById(`item-${index}`);
        if (targetItem) {
          let scrollPos = targetItem.offsetTop; 
          if (scrollPos < 0) scrollPos = 0;
          detailsContainer.scrollTo({ top: scrollPos, behavior: 'smooth' });
        }
      });
    }
  });

  // Interaksi Klik Panel Linimasa
  detailsContainer.addEventListener('click', function(e) {
    if (e.target && e.target.classList.contains('timeline-date')) {
      let parentDiv = e.target.closest('.timeline-item');
      let indexStr = parentDiv.getAttribute('data-index');
      hentikanPlay(); 

      if (indexStr === '-1') {
        indexAktif = '-1';
        Map.closePopup();
        if (markerBounds.length > 0) {
          Map.flyToBounds(markerBounds, dapatkanOpsiBounds(true));
        }
        gulirkanPanelLewatKode(0);
      } else {
        let index = parseInt(indexStr);
        let targetRecord = TimelineRecords[index];
        if (targetRecord && targetRecord.marker) {
          targetRecord.marker.openPopup();
          fokusKeMarker(targetRecord.marker.getLatLng(), false); 
          indexAktif = indexStr; 

          let scrollPos = parentDiv.offsetTop;
          if (scrollPos < 0) scrollPos = 0;
          gulirkanPanelLewatKode(scrollPos);
        }
      }
    }
  });

  ['wheel', 'touchstart', 'touchmove'].forEach(namaEvent => {
    detailsContainer.addEventListener(namaEvent, () => {
      if (typeof scrollTimeout !== 'undefined' && scrollTimeout) clearTimeout(scrollTimeout);
      if (detailsContainer.classList.contains('sedang-auto-scroll')) {
        detailsContainer.classList.remove('sedang-auto-scroll');
      }
      if (isPlaying) hentikanPlay();
    }, { passive: true }); 
  });

  detailsContainer.addEventListener('scrollend', () => {
    if (scrollTimeout) clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      detailsContainer.classList.remove('sedang-auto-scroll');
    }, 100);
  });

  // Intersection Observer
  let intersectingItems = new Set();
  let observerOptions = {
    root: detailsContainer,
    rootMargin: '0px 0px -95% 0px', 
    threshold: 0 
  };

  let observer = new IntersectionObserver((entries) => {
    entries.forEach(entry => {
      if (entry.isIntersecting) {
        intersectingItems.add(entry.target);
      } else {
        intersectingItems.delete(entry.target);
      }
    });

    if (detailsContainer.classList.contains('sedang-auto-scroll')) return;

    let kandidatTerpilih = null;
    if (intersectingItems.size > 0) {
      let minIdx = Infinity;
      intersectingItems.forEach(item => {
        let idx = parseInt(item.getAttribute('data-index'));
        if (idx < minIdx) {
          minIdx = idx;
          kandidatTerpilih = idx.toString();
        }
      });
    }

    if (kandidatTerpilih !== null && kandidatTerpilih !== indexAktif) {
      indexAktif = kandidatTerpilih; 
      hentikanPlay(); 

      if (indexAktif === '-1') {
        Map.closePopup();
        if (markerBounds.length > 0) {
          Map.flyToBounds(markerBounds, dapatkanOpsiBounds(true));
        }
      } else {
        let indexAngka = parseInt(indexAktif);
        let targetRecord = TimelineRecords[indexAngka];
        
        if (targetRecord && targetRecord.marker && !targetRecord.marker.isPopupOpen()) {
          targetRecord.marker.openPopup();
          fokusKeMarker(targetRecord.marker.getLatLng(), false); 
        }
      }
    }
  }, observerOptions);

  document.querySelectorAll('.timeline-item').forEach(item => {
    observer.observe(item);
  });

  document.getElementById('loading').style.display = 'none';
  detailsContainer.style.display = 'block';

  if (markerBounds.length > 0) {
    Map.fitBounds(markerBounds, dapatkanOpsiBounds(false));
  }
}

// ==========================================
// 5. FUNGSI UTILITAS
// ==========================================
function fokusKeMarker(latlng, keepCurrentZoom = false, durasi = 1.2, gunakanPanTo = false) {
  let targetZoom = keepCurrentZoom ? Map.getZoom() : 12;
  let koordinatAkhir = latlng;

  if (window.innerWidth <= 800) {
    let targetPoint = Map.project(latlng, targetZoom);
    targetPoint.y += 40; 
    koordinatAkhir = Map.unproject(targetPoint, targetZoom);
  }

  if (gunakanPanTo) {
    Map.panTo(koordinatAkhir, { animate: true });
  } else {
    let currentCenter = Map.getCenter();
    let currentZoom = Map.getZoom();

    if (currentZoom === targetZoom && currentCenter.distanceTo(koordinatAkhir) < 5) return; 

    Map.flyTo(koordinatAkhir, targetZoom, {
      animate: true,
      duration: durasi
    });
  }
}

function formatWikidataDate(dateString, precision) {
  if (!dateString) return null;  
  let cleanStr = dateString.replace(/^[+-]/, '');   
  let yearStr  = cleanStr.substring(0, 4);
  let monthStr = cleanStr.substring(5, 7);
  let dayStr   = cleanStr.substring(8, 10);
  let yearNum  = parseInt(yearStr);
  const bulanIndo = ['', 'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'];
  
  let prec = parseInt(precision) || 9; 
  if (prec === 11) return `${parseInt(dayStr)} ${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  else if (prec === 10) return `${bulanIndo[parseInt(monthStr)]} ${yearStr}`;
  else if (prec === 9) return yearStr;
  else if (prec === 8) return `${yearStr}-an`;
  else if (prec === 7) return `Abad ke-${Math.ceil(yearNum / 100)}`;
  else return yearStr;
}

// ==========================================
// 6. PENINGKATAN TAMPILAN PONSEL (IIFE)
// ==========================================
(function() {
  var MOBILE_QUERY   = '(max-width: 800px)';
  var DRAG_THRESHOLD = 5;  

  var panel, header;
  var currentY       = 0;
  var dragging       = false;
  var moved          = false;
  var startClientY   = 0;
  var startTranslate = 0;

  function isMobile() {
    return window.matchMedia(MOBILE_QUERY).matches;
  }

  function getExpandedY() {
    return window.innerHeight / 2;
  }

  function getCollapsedY() {
    var tinggiPanel = panel.getBoundingClientRect().height;
    var tinggiHeader = header.getBoundingClientRect().height || 56; 
    var angkaKoreksi = 55; 
    return tinggiPanel - tinggiHeader - angkaKoreksi; 
  }

  function clampY(y) {
    return Math.min(Math.max(y, getExpandedY()), getCollapsedY());
  }

  function applyTransform(y) {
    currentY = y;
    panel.style.transform = 'translateY(' + y + 'px)';
  }

  window.setMobilePanelExpanded = function(expand, animate) {
    if (!panel || !isMobile()) return;
    
    if (animate === false) panel.classList.add('eph-dragging');
    else panel.classList.remove('eph-dragging');
    
    applyTransform(expand ? getExpandedY() : getCollapsedY());
    
    if (animate === false) {
      void panel.offsetWidth; 
      panel.classList.remove('eph-dragging');
    }
  };

  function onTouchStart(e) {
    if (!isMobile()) return;
    if (e.target.closest('#play-btn')) return;

    var touch = e.touches ? e.touches[0] : e;
    dragging = true;
    moved = false;
    startClientY = touch.clientY;
    startTranslate = currentY;
    panel.classList.add('eph-dragging');
  }

  function onTouchMove(e) {
    if (!dragging) return;
    var touch = e.touches ? e.touches[0] : e;
    var delta = touch.clientY - startClientY;

    if (Math.abs(delta) > DRAG_THRESHOLD) {
      moved = true;
      if (e.cancelable) e.preventDefault(); 
    }
    applyTransform(clampY(startTranslate + delta));
  }

  function onTouchEnd() {
    if (!dragging) return;
    dragging = false;

    if (!moved) {
      var isExpanded = currentY <= getExpandedY() + 10;
      window.setMobilePanelExpanded(!isExpanded);
    } else {
      var dragDistance = currentY - startTranslate;
      var SWIPE_THRESHOLD = 40; 

      if (dragDistance > SWIPE_THRESHOLD) {
        window.setMobilePanelExpanded(false); 
      } else if (dragDistance < -SWIPE_THRESHOLD) {
        window.setMobilePanelExpanded(true);  
      } else {
        var wasExpanded = startTranslate <= getExpandedY() + 10;
        window.setMobilePanelExpanded(wasExpanded);
      }
    }
    panel.classList.remove('eph-dragging');
  }

  function handleViewportChange() {
    if (!panel) return;
    var detailsContainer = document.getElementById('details');

    if (isMobile()) {
      window.setMobilePanelExpanded(true, false);
      if (detailsContainer) {
        detailsContainer.style.paddingBottom = (window.innerHeight / 2) + 'px';
      }
    } else {
      panel.style.transform = '';
      panel.classList.remove('eph-dragging');
      currentY = 0;
      if (detailsContainer) {
        detailsContainer.style.paddingBottom = '0px';
      }
    }
  }

  window.addEventListener('load', function() {
    panel = document.getElementById('panel');
    header = document.getElementById('branding');
    if (!panel || !header) return;

    var dragHandle = document.getElementById('drag-handle');
    if (!dragHandle) {
      dragHandle = document.createElement('div');
      dragHandle.id = 'drag-handle';
      panel.insertBefore(dragHandle, panel.firstChild);
    }

    var playBtn = document.getElementById('play-btn');
    if (!playBtn) {
      playBtn = document.createElement('button');
      playBtn.id = 'play-btn';
      playBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>'; 
      header.appendChild(playBtn);
    }
    
    var oldToggle = document.getElementById('panel-toggle');
    if (oldToggle) oldToggle.remove();

    handleViewportChange();

    dragHandle.addEventListener('touchstart', onTouchStart, { passive: false });
    dragHandle.addEventListener('touchmove', onTouchMove, { passive: false });
    dragHandle.addEventListener('touchend', onTouchEnd);
    dragHandle.addEventListener('touchcancel', onTouchEnd);

    header.addEventListener('touchstart', onTouchStart, { passive: false });
    header.addEventListener('touchmove', onTouchMove, { passive: false });
    header.addEventListener('touchend', onTouchEnd);
    header.addEventListener('touchcancel', onTouchEnd);
  });
  
  window.addEventListener('resize', handleViewportChange);
})();
