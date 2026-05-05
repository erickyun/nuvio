// ============================================================
//  FilmMakinesi — Nuvio Provider
//  KekikStream FilmMakinesi.py + KentFilm.py + PlayerFilmIzle.py
//  Sadece Film (dizi yok)
// ============================================================

var BASE_URL     = 'https://filmmakinesi.to';
var TMDB_API_KEY = '4ef0d7355d9ffb5151e987764708ce96';

var UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

var HEADERS = {
  'User-Agent':     UA,
  'Accept':         'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language':'tr-TR,tr;q=0.9,en-US;q=0.8',
  'Referer':        BASE_URL + '/'
};

// ── Yardımcı ─────────────────────────────────────────────────

function decodeHtml(s) {
  if (!s) return '';
  return s.replace(/&amp;/g,'&').replace(/&lt;/g,'<').replace(/&gt;/g,'>')
          .replace(/&quot;/g,'"').replace(/&#039;/g,"'").replace(/&nbsp;/g,' ').trim();
}

function fixUrl(url) {
  if (!url) return '';
  url = String(url).replace(/\\\\/g,'').replace(/\\/g,'');
  if (url.startsWith('http')) return url;
  if (url.startsWith('//'))   return 'https:' + url;
  return BASE_URL + (url.startsWith('/') ? '' : '/') + url;
}

function regexFirst(text, pattern, flags) {
  var m = new RegExp(pattern, flags || 's').exec(text);
  return m ? m[1] : null;
}

function getBaseUrl(url) {
  try {
    var u = new URL(url);
    return u.protocol + '//' + u.host;
  } catch(e) {
    return BASE_URL;
  }
}

// ── TMDB ─────────────────────────────────────────────────────

function fetchTmdbInfo(tmdbId) {
  return fetch('https://api.themoviedb.org/3/movie/' + tmdbId +
    '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title          || '',
        titleEn: d.original_title || '',
        year:   (d.release_date   || '').slice(0,4)
      };
    });
}

// ── Arama + eşleştirme ───────────────────────────────────────

function normalize(s) {
  return (s||'').toLowerCase()
    .replace(/[ğ]/g,'g').replace(/[ü]/g,'u').replace(/[ş]/g,'s')
    .replace(/[ıi]/g,'i').replace(/[ö]/g,'o').replace(/[ç]/g,'c')
    .replace(/[^a-z0-9]/g,' ').replace(/\s+/g,' ').trim();
}

function searchFilmMakinesi(query) {
  return fetch(BASE_URL + '/arama/?s=' + encodeURIComponent(query), { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var results = [];
      // div.item-relative içinde a[href] ve div.title
      var itemRe = /<div[^>]+class="[^"]*item-relative[^"]*"[^>]*>([\s\S]*?)(?=<div[^>]+class="[^"]*item-relative|$)/g;
      var m;
      while ((m = itemRe.exec(html)) !== null) {
        var block  = m[1];
        var title  = regexFirst(block, /<div[^>]+class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/div>/);
        var href   = regexFirst(block, /href="([^"]+)"/);
        var poster = regexFirst(block, /data-src="([^"]+)"/)
                  || regexFirst(block, /src="([^"]+\.(?:jpg|jpeg|png|webp)[^"]*)"/);
        if (!title || !href) continue;
        results.push({ title: decodeHtml(title), href: fixUrl(href), poster: poster ? fixUrl(poster) : null });
      }
      return results;
    })
    .catch(function() { return []; });
}

function findBest(results, en, tr, year) {
  var nEn = normalize(en), nTr = normalize(tr);
  var scored = results.map(function(r) {
    var ni = normalize(r.title), score = 0;
    if (ni === nEn || ni === nTr)                                     score += 100;
    else if (nEn && (ni.indexOf(nEn)!==-1 || nEn.indexOf(ni)!==-1))  score += 65;
    else if (nTr && (ni.indexOf(nTr)!==-1 || nTr.indexOf(ni)!==-1))  score += 60;
    if (year && r.href && r.href.indexOf(year)!==-1)                  score += 10;
    return { r:r, score:score };
  });
  scored.sort(function(a,b){ return b.score-a.score; });
  return (scored.length && scored[0].score >= 55) ? scored[0].r : null;
}

// ── KentFilm extractor ────────────────────────────────────────
// KentFilm.py: FirePlayer(id, {videoUrl, videoServer, videoDisk}, false)
// GET url → regex FirePlayer JSON → videoUrl + ?s=server&d=disk

function extractKentFilm(url, label) {
  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // FirePlayer(id, {...}, false) içinden JSON al
    var jsonStr = regexFirst(html, /FirePlayer\s*\(\s*[^,]+\s*,\s*(\{.*?\})\s*,\s*false\s*\)/)
               || regexFirst(html, /FirePlayer\s*\(\s*[^,]+\s*,\s*(\{.*?\})\s*,/);

    if (!jsonStr) {
      console.log('[FilmMakinesi] KentFilm: JSON bulunamadı: ' + url);
      return null;
    }

    // videoUrl, videoServer, videoDisk regex ile çıkar (JSON.parse yerine — kaçış sorunları olabilir)
    var videoUrl    = regexFirst(jsonStr, /"videoUrl"\s*:\s*"([^"]+)"/);
    var videoServer = regexFirst(jsonStr, /"videoServer"\s*:\s*"([^"]+)"/);
    var videoDisk   = regexFirst(jsonStr, /"videoDisk"\s*:\s*"([^"]+)"/);

    if (!videoUrl) {
      console.log('[FilmMakinesi] KentFilm: videoUrl yok: ' + url);
      return null;
    }

    // \/ → / unescape
    videoUrl = videoUrl.replace(/\\\//g, '/');

    // /cdn/hls/... → tam URL
    if (videoUrl.startsWith('/')) {
      videoUrl = 'https://kentfilmizle.xyz' + videoUrl;
    }

    // ?s=server&d=disk ekle
    if (videoServer) {
      videoUrl = videoUrl + '?s=' + videoServer + '&d=' + (videoDisk || '');
    }

    var sourceName = label ? 'KentFilm | ' + label : 'KentFilm';
    return {
      name:     'FilmMakinesi',
      title:    '⌜ FİLMMAKİNESİ ⌟ | ' + sourceName,
      url:      videoUrl,
      quality:  'Auto',
      headers:  { 'Referer': url, 'User-Agent': UA }
    };
  })
  .catch(function(e) {
    console.log('[FilmMakinesi] KentFilm hata: ' + e);
    return null;
  });
}

// ── PlayerFilmIzle extractor ──────────────────────────────────
// PlayerFilmIzle.py:
// 1. GET url → Packer.unpack (eval JS) → FirePlayer("HASH")
// 2. POST /player/index.php?data=HASH&do=getVideo → securedLink

function extractPlayerFilmIzle(url, label) {
  var baseUrl = getBaseUrl(url);

  return fetch(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' })
  })
  .then(function(r) { return r.text(); })
  .then(function(html) {
    // Altyazılar (PlayerFilmIzle.py: playerjsSubtitle)
    var subs = [];
    var rawSubs = regexFirst(html, /playerjsSubtitle\s*=\s*"([^"]*)"/);
    if (rawSubs) {
      var subRe = /\[(.*?)\](https?:\/\/[^\s",]+)/g;
      var sm;
      while ((sm = subRe.exec(rawSubs)) !== null) {
        subs.push({ name: sm[1].trim(), url: sm[2].trim() });
      }
    }

    // eval(function(p,a,c,k,e,d)...) → unpack
    var content = html;
    var evalMatch = html.match(/eval\(function\(p,a,c,k,e,(?:d|r)\)([\s\S]+?)\)\s*;/);
    if (evalMatch) {
      // Basit unpack: string literal array'den token'ları çıkar
      try {
        var packed   = evalMatch[0];
        var arrMatch = packed.match(/'([^']+)'\s*\.split\('\|'\)/);
        if (arrMatch) {
          var tokens  = arrMatch[1].split('|');
          var fmtMatch = packed.match(/,\s*0,\s*\{\}\)\)/);
          // Tokenleri sırayla koy — FirePlayer hash genellikle ilk anlamlı hex token
          content = packed;
          tokens.forEach(function(t, i) {
            if (t) content = content.replace(new RegExp('\\b' + i + '\\b', 'g'), t);
          });
        }
      } catch(e) {}
    }

    // FirePlayer("HEXHASH") veya FirePlayer('HEXHASH')
    var dataVal = regexFirst(content, /FirePlayer\s*\(\s*["']([a-f0-9A-F]+)["']/);
    if (!dataVal) {
      // Fallback: data-hash attribute
      dataVal = regexFirst(html, /data-hash=["']([a-f0-9A-F]+)["']/);
    }
    if (!dataVal) {
      console.log('[FilmMakinesi] PlayerFilmIzle: hash yok: ' + url);
      return null;
    }

    // POST /player/index.php?data=HASH&do=getVideo
    var postUrl = baseUrl + '/player/index.php?data=' + dataVal + '&do=getVideo';
    return fetch(postUrl, {
      method:  'POST',
      headers: {
        'Content-Type':     'application/x-www-form-urlencoded',
        'X-Requested-With': 'XMLHttpRequest',
        'Referer':          url,
        'User-Agent':       UA
      },
      body: 'hash=' + encodeURIComponent(dataVal) + '&r=' + encodeURIComponent(BASE_URL + '/')
    })
    .then(function(r) { return r.text(); })
    .then(function(resp) {
      // "securedLink":"https://...m3u8..."
      var m3u8 = regexFirst(resp, /"securedLink"\s*:\s*"([^"]+)"');
      if (!m3u8) {
        // Fallback: file: "..."
        m3u8 = regexFirst(resp, /["']file["']\s*:\s*["'](https?[^"']+\.m3u8[^"']*)["']/);
      }
      if (!m3u8) {
        console.log('[FilmMakinesi] PlayerFilmIzle: securedLink yok: ' + url);
        return null;
      }

      m3u8 = m3u8.replace(/\\\//g, '/').replace(/\\/g, '');
      var sourceName = label ? 'PlayerFilmIzle | ' + label : 'PlayerFilmIzle';
      return {
        name:      'FilmMakinesi',
        title:     '⌜ FİLMMAKİNESİ ⌟ | ' + sourceName,
        url:       m3u8,
        quality:   'Auto',
        headers:   { 'Referer': url, 'User-Agent': UA },
        subtitles: subs
      };
    });
  })
  .catch(function(e) {
    console.log('[FilmMakinesi] PlayerFilmIzle hata: ' + e);
    return null;
  });
}

// ── Video parts + iframe parse ────────────────────────────────
// FilmMakinesi.py load_links():
// 1. div.video-parts a[data-video_url] → her part için extract
// 2. Yoksa iframe[data-src] → extract

function extractFromUrl(videoUrl, label) {
  var isKentFilm = videoUrl.indexOf('kentfilmizle') !== -1;
  var isPlayerFilm = videoUrl.indexOf('filmizle.in') !== -1 ||
                     videoUrl.indexOf('filmdefilm.xyz') !== -1 ||
                     videoUrl.indexOf('filmpablo.xyz') !== -1 ||
                     videoUrl.toLowerCase().indexOf('fireplayer') !== -1;

  if (isKentFilm) {
    return extractKentFilm(videoUrl, label);
  } else if (isPlayerFilm) {
    return extractPlayerFilmIzle(videoUrl, label);
  } else {
    // Bilinmeyen kaynak — direkt m3u8 dene
    if (videoUrl.indexOf('m3u8') !== -1) {
      return Promise.resolve({
        name:    'FilmMakinesi',
        title:   '⌜ FİLMMAKİNESİ ⌟ | ' + (label || 'Video'),
        url:     videoUrl,
        quality: 'Auto',
        headers: { 'Referer': BASE_URL + '/', 'User-Agent': UA }
      });
    }
    // Her iki extractor'ı sırayla dene
    return extractKentFilm(videoUrl, label).then(function(r) {
      if (r) return r;
      return extractPlayerFilmIzle(videoUrl, label);
    });
  }
}

function fetchPageStreams(pageUrl) {
  return fetch(pageUrl, { headers: HEADERS })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var tasks = [];

      // div.video-parts a[data-video_url]
      var partRe = /<a[^>]+data-video_url="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
      var pm;
      while ((pm = partRe.exec(html)) !== null) {
        var videoUrl = pm[1];
        var rawLabel = pm[2].replace(/<[^>]+>/g,'').trim();
        // label'dan sadece ilk kelimeyi al (Python: label.split()[0])
        var label    = rawLabel ? rawLabel.split(/\s+/)[0] : null;
        if (videoUrl) tasks.push({ url: fixUrl(videoUrl), label: label });
      }

      // video-parts yoksa iframe data-src
      if (!tasks.length) {
        var iframeSrc = regexFirst(html, /<iframe[^>]+data-src="([^"]+)"/);
        if (iframeSrc) tasks.push({ url: fixUrl(iframeSrc), label: null });
      }

      if (!tasks.length) {
        console.log('[FilmMakinesi] Hiç kaynak bulunamadı: ' + pageUrl);
        return [];
      }

      // Paralel — max 4
      var results = [], idx = 0;
      function next() {
        if (idx >= tasks.length) return Promise.resolve();
        var t = tasks[idx++];
        return extractFromUrl(t.url, t.label)
          .then(function(r) { if (r) results.push(r); return next(); });
      }
      var workers = [];
      for (var i = 0; i < Math.min(4, tasks.length); i++) workers.push(next());
      return Promise.all(workers).then(function() { return results; });
    })
    .catch(function() { return []; });
}

// ── Ana fonksiyon ─────────────────────────────────────────────

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  // FilmMakinesi sadece film — dizi isteği gelirse boş dön
  if (mediaType !== 'movie') return Promise.resolve([]);

  return fetchTmdbInfo(tmdbId)
    .then(function(info) {
      if (!info.titleEn && !info.titleTr) return [];

      return searchFilmMakinesi(info.titleEn || info.titleTr)
        .then(function(results) {
          var best = findBest(results, info.titleEn, info.titleTr, info.year);
          if (!best && info.titleTr && info.titleTr !== info.titleEn) {
            return searchFilmMakinesi(info.titleTr).then(function(r2) {
              return findBest(r2, info.titleEn, info.titleTr, info.year);
            });
          }
          return best;
        })
        .then(function(best) {
          if (!best) {
            console.log('[FilmMakinesi] Bulunamadı: ' + info.titleEn);
            return [];
          }
          console.log('[FilmMakinesi] Eşleşti: ' + best.title + ' → ' + best.href);
          return fetchPageStreams(best.href);
        });
    })
    .catch(function(e) {
      console.error('[FilmMakinesi] Hata: ' + e);
      return [];
    });
}

// ── Export ────────────────────────────────────────────────────
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
