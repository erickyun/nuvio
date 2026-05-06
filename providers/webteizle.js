// ============================================================
//  WebteIzle — Nuvio Provider (V32 Precision & Clean)
// ============================================================

var BASE_URL     = 'https://webteizle3.xyz';
var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:137.0) Gecko/20100101 Firefox/137.0',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en;q=0.8',
  'Referer': BASE_URL + '/'
};

// ── TMDB Verisi ──────────────────────────────────────────────
function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = (mediaType === 'tv') ? 'tv' : 'movie';
  return fetch('https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId
      + '?api_key=' + TMDB_API_KEY + '&language=tr-TR')
    .then(function(r) { return r.json(); })
    .then(function(d) {
      return {
        titleTr: d.title  || d.name  || '',
        titleEn: d.original_title || d.original_name || '',
        year:    (d.release_date || d.first_air_date || '').slice(0, 4)
      };
    });
}

// ── Slug Dönüştürücü ──────────────────────────────────────────
function titleToSlug(title) {
  return (title || '').toLowerCase()
    .replace(/\u011f/g,'g').replace(/\u00fc/g,'u').replace(/\u015f/g,'s')
    .replace(/\u0131/g,'i').replace(/\u0130/g,'i').replace(/\u00f6/g,'o').replace(/\u00e7/g,'c')
    .replace(/[^a-z0-9]+/g,'-').replace(/^-+|-+$/g,'');
}

// ── Sayfa Bulma ───────────────────────────────────────────────
function findFilmPage(titleTr, titleEn) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);

  var candidates = [];
  if (slugTr) {
    candidates.push(BASE_URL + '/izle/dublaj/' + slugTr);
    candidates.push(BASE_URL + '/izle/altyazi/' + slugTr);
  }
  if (slugEn && slugEn !== slugTr) {
    candidates.push(BASE_URL + '/izle/dublaj/' + slugEn);
    candidates.push(BASE_URL + '/izle/altyazi/' + slugEn);
  }

  function tryNext(i) {
    if (i >= candidates.length) return searchFallback(titleTr, titleEn);
    var url = candidates[i];
    return fetch(url, { headers: HEADERS })
      .then(function(r) {
        if (!r.ok) return tryNext(i + 1);
        return r.text().then(function(html) {
          if (html.indexOf('data-id') === -1) return tryNext(i + 1);
          return { url: url, html: html };
        });
      })
      .catch(function() { return tryNext(i + 1); });
  }
  return tryNext(0);
}

// ── Arama Fallback ────────────────────────────────────────────
function searchFallback(titleTr, titleEn) {
  var query = titleTr || titleEn;
  return fetch(BASE_URL + '/ajax/arama.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, {
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
      'X-Requested-With': 'XMLHttpRequest'
    }),
    body: 'q=' + encodeURIComponent(query)
  })
  .then(function(r) { return r.json(); })
  .then(function(data) {
    if (data.status !== 'success') throw new Error('Arama basarisiz');
    var items = (data.results && data.results.filmler && data.results.filmler.results) || [];
    if (!items.length) throw new Error('Film bulunamadi');

    var best = items[0];
    var pageUrl = best.url.startsWith('http') ? best.url : BASE_URL + best.url;
    return fetch(pageUrl, { headers: HEADERS })
      .then(function(r) { return r.text().then(function(html) { return { url: pageUrl, html: html }; }); });
  });
}

// ── Parsers ───────────────────────────────────────────────────
function parseFilmId(html) {
  var m = html.match(/data-id="(\d+)"[^>]*id="wip"/)
       || html.match(/id="wip"[^>]*data-id="(\d+)"/)
       || html.match(/button[^>]+id="wip"[^>]+data-id="(\d+)"/)
       || html.match(/data-id="(\d+)"/);
  return m ? m[1] : null;
}

function parseDilList(html, pageUrl) {
  var diller = [];
  if (html.indexOf('/izle/dublaj/') !== -1 || pageUrl.indexOf('/izle/dublaj/') !== -1) diller.push({ dil: '0', ad: 'TR Dublaj' });
  if (html.indexOf('/izle/altyazi/') !== -1 || pageUrl.indexOf('/izle/altyazi/') !== -1) diller.push({ dil: '1', ad: 'TR Altyazı' });
  if (diller.length === 0) { diller.push({ dil: '0', ad: 'TR Dublaj' }); diller.push({ dil: '1', ad: 'TR Altyazı' }); }
  return diller;
}

// ── Alternatifleri Getir ──────────────────────────────────────
function fetchAlternatifler(filmId, dil, seasonNum, episodeNum) {
  var body = 'filmid=' + filmId + '&dil=' + dil + '&s=' + (seasonNum || '') + '&b=' + (episodeNum || '') + '&bot=0';
  return fetch(BASE_URL + '/ajax/dataAlternatif3.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'X-Requested-With': 'XMLHttpRequest', 
        'Origin': BASE_URL 
    }),
    body: body
  })
  .then(function(r) { return r.json(); })
  .then(function(data) { 
      return (data.status === 'success' && Array.isArray(data.data)) ? data.data : []; 
  });
}

// ── Embed Çözücü ──────────────────────────────────────────────
function fetchEmbedIframe(embedId) {
  return fetch(BASE_URL + '/ajax/dataEmbed.asp', {
    method: 'POST',
    headers: Object.assign({}, HEADERS, { 
        'Content-Type': 'application/x-www-form-urlencoded', 
        'X-Requested-With': 'XMLHttpRequest', 
        'Origin': BASE_URL 
    }),
    body: 'id=' + embedId
  }).then(function(r) { return r.text(); }).then(function(html) {
    var m = html.match(/<iframe[^>]+src="([^"]+)"/i);
    if (m) return m[1];
    var sm = html.match(/(vidmoly|okru|filemoon|dzen|sibnet|sruby|pixel|mailru)\s*\(\s*'([^']+)'/i);
    if (sm) {
      var p = sm[1].toLowerCase(); var vid = sm[2];
      if (p === 'vidmoly')  return 'https://vidmoly.net/embed-' + vid + '.html';
      if (p === 'okru')     return 'https://odnoklassniki.ru/videoembed/' + vid;
      if (p === 'filemoon') return 'https://filemoon.sx/e/' + vid;
      if (p === 'dzen')     return 'https://dzen.ru/video/watch/' + vid;
      if (p === 'sibnet')   return 'https://video.sibnet.ru/shell.php?videoid=' + vid;
      if (p === 'sruby')    return 'https://rubyvidhub.com/embed-' + vid + '.html';
      if (p === 'pixel')    return 'https://pixeldrain.com/u/' + vid;
      if (p === 'mailru')   return 'https://my.mail.ru/video/embed/' + vid;
    }
    return null;
  });
}

// ── VidMoly M3U8 Çekici ───────────────────────────────────────
function fetchVidMolyStream(iframeUrl) {
  var fullUrl = iframeUrl.startsWith('//') ? 'https:' + iframeUrl : iframeUrl;
  fullUrl = fullUrl.replace('vidmoly.to', 'vidmoly.net');
  return fetch(fullUrl, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: fullUrl } : null;
    });
}

// ── Sibnet Çekici ────────────────────────────────────────────
function fetchSibnetStream(src) {
  var id = (src.match(/videoid=(\d+)/) || src.match(/video(\d+)/) || [])[1];
  if (!id) return Promise.resolve(null);
  var shellUrl = 'https://video.sibnet.ru/shell.php?videoid=' + id;
  return fetch(shellUrl, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://video.sibnet.ru/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var m = html.match(/src\s*:\s*"(\/v\/[^"]+\.mp4[^"]*)"/i);
      if (!m) return null;
      return { url: 'https://video.sibnet.ru' + m[1], type: 'direct', referer: shellUrl };
    })
    .catch(function() { return null; });
}

// ── Dzen Çekici ───────────────────────────────────────────────
function fetchDzenStream(src) {
  var videoKey = src.split('/').pop().split('?')[0];
  var embedUrl = 'https://dzen.ru/embed/' + videoKey;
  return fetch(embedUrl, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://dzen.ru/', 'Origin': 'https://dzen.ru' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var re = /https:\/\/vd\d+\.okcdn\.ru\/\?[^\s"'\\<>]+/g;
      var m, links = [], seen = {};
      while ((m = re.exec(html)) !== null) {
        if (!seen[m[0]]) { seen[m[0]] = true; links.push(m[0]); }
      }
      if (links.length) return { url: links[links.length - 1], type: 'direct', referer: 'https://dzen.ru/' };
      var fm = html.match(/(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      if (fm) return { url: fm[1], type: 'hls', referer: 'https://dzen.ru/' };
      return null;
    })
    .catch(function() { return null; });
}

// ── OkRu Çekici ──────────────────────────────────────────────
function fetchOkRuStream(src) {
  var url = src.indexOf('/videoembed/') === -1
    ? src.replace('/video/', '/videoembed/')
    : src;
  if (!url.startsWith('http')) url = 'https://ok.ru' + url;
  return fetch(url, { headers: Object.assign({}, HEADERS, { 'Referer': 'https://ok.ru/', 'Origin': 'https://ok.ru' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      var dataM = html.match(/data-options="([^"]+)"/i);
      if (dataM) {
        try {
          var opts = JSON.parse(dataM[1].replace(/&amp;/g,'&').replace(/&quot;/g,'"'));
          var meta = (opts.flashvars && opts.flashvars.metadata) ? JSON.parse(opts.flashvars.metadata) : null;
          if (meta) {
            if (meta.ondemandHls) return { url: meta.ondemandHls.replace(/u0026/g,'&'), type: 'hls', referer: url };
            var order = ['ULTRA','QUAD','FULL','HD','SD','LOW','MOBILE'];
            var videos = meta.videos || [];
            for (var qi = 0; qi < order.length; qi++)
              for (var vi = 0; vi < videos.length; vi++)
                if ((videos[vi].name||'').toUpperCase() === order[qi])
                  return { url: videos[vi].url.replace(/u0026/g,'&'), type: 'direct', referer: url };
          }
        } catch(e) {}
      }
      return null;
    })
    .catch(function() { return null; });
}

// ── Filemoon Çekici ───────────────────────────────────────────
function fetchFilemoonStream(src) {
  var fullUrl = src.startsWith('//') ? 'https:' + src : src;
  return fetch(fullUrl, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
    .then(function(r) { return r.text(); })
    .then(function(html) {
      // packed JS çöz
      var unpacked = html;
      var pm = html.match(/eval\(function\(p,a,c,k,e,[^)]*\)[\s\S]+?\)\)/);
      if (pm) {
        try {
          var parts = pm[0].match(/\('([\s\S]+?)',(\d+),(\d+),'([^']*)'/);
          if (parts) {
            var p = parts[1], a = parseInt(parts[2]), c = parseInt(parts[3]);
            var k = parts[4].split('|');
            function e(n) { return (n<a?'':e(Math.floor(n/a)))+((n=n%a)>35?String.fromCharCode(n+29):n.toString(36)); }
            while (c--) { if (k[c]) p = p.replace(new RegExp('\\b'+e(c)+'\\b','g'), k[c]); }
            unpacked = p;
          }
        } catch(ex) {}
      }
      var m = unpacked.match(/file\s*:\s*["']?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
      return m ? { url: m[1], type: 'hls', referer: fullUrl } : null;
    })
    .catch(function() { return null; });
}

// ── Embed İşleyici (UI Verisi Buradan Çıkar) ───────────────────
function processEmbed(embedData, dilAd, movieTitle) {
  var baslik = (embedData.baslik || '').toLowerCase();
  if (baslik === 'pixel' || baslik === 'netu') return Promise.resolve(null);

  return fetchEmbedIframe(embedData.id).then(function(src) {
    if (!src) return null;
    
    var flag = dilAd.includes('Dublaj') ? '🇹🇷 ' : '🌐 ';
    var q = embedData.kalite || 'Auto';
    var pName = 'Kaynak';
    if (src.indexOf('vidmoly') !== -1)  pName = 'VidMoly';
    else if (src.indexOf('sibnet') !== -1)   pName = 'Sibnet';
    else if (src.indexOf('filemoon') !== -1) pName = 'FileMoon';
    else if (src.indexOf('dzen.ru') !== -1)  pName = 'Dzen';
    else if (src.indexOf('ok.ru') !== -1 || src.indexOf('odnoklassniki') !== -1) pName = 'OkRu';
    else if (src.indexOf('rubyvidhub') !== -1) pName = 'RubyVid';
    else if (src.indexOf('pixeldrain') !== -1) pName = 'PixelDrain';
    else if (src.indexOf('mail.ru') !== -1)    pName = 'MailRu';

    function makeStream(s) {
      if (!s) return null;
      return {
        url:     s.url,
        name:    movieTitle,
        title:   '⌜ WEBTEIZLE ⌟ | ' + pName + ' | ' + flag + dilAd,
        quality: s.quality || q,
        type:    s.type    || 'hls',
        headers: { 'Referer': s.referer || src, 'User-Agent': HEADERS['User-Agent'] }
      };
    }

    var streamPromise;
    if (src.indexOf('vidmoly') !== -1) {
      streamPromise = fetchVidMolyStream(src).then(makeStream);
    } else if (src.indexOf('sibnet.ru') !== -1) {
      streamPromise = fetchSibnetStream(src).then(makeStream);
    } else if (src.indexOf('dzen.ru') !== -1) {
      streamPromise = fetchDzenStream(src).then(makeStream);
    } else if (src.indexOf('ok.ru') !== -1 || src.indexOf('odnoklassniki') !== -1) {
      streamPromise = fetchOkRuStream(src).then(makeStream);
    } else if (src.indexOf('filemoon') !== -1 || src.indexOf('bysezoxexe') !== -1) {
      streamPromise = fetchFilemoonStream(src).then(makeStream);
    } else if (src.indexOf('pixeldrain') !== -1) {
      var fileId = src.split('/u/').pop().split('?')[0];
      streamPromise = Promise.resolve(makeStream({ url: 'https://pixeldrain.com/api/file/' + fileId + '?download', type: 'direct', referer: 'https://pixeldrain.com/' }));
    } else {
      streamPromise = fetch(src, { headers: Object.assign({}, HEADERS, { 'Referer': BASE_URL + '/' }) })
        .then(function(r) { return r.text(); })
        .then(function(html) {
          var m = html.match(/file\s*:\s*['"]?(https?:\/\/[^\s"'<>]+\.m3u8[^\s"'<>]*)/i);
          return makeStream(m ? { url: m[1], type: 'hls', referer: src } : null);
        })
        .catch(function() { return null; });
    }
    return streamPromise;
  });
}

// ── Ana Fonksiyon ─────────────────────────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      var movieName = info.titleTr || info.titleEn;
      return findFilmPage(info.titleTr, info.titleEn).then(function(result) {
        var filmId = parseFilmId(result.html);
        if (!filmId) throw new Error('Film ID bulunamadi');
        
        var diller = parseDilList(result.html, result.url);
        var streams = [];
        return Promise.all(diller.map(function(d) {
          return fetchAlternatifler(filmId, d.dil, season, episode).then(function(embedList) {
            return Promise.all(embedList.map(function(e) { return processEmbed(e, d.ad, movieName); }));
          }).then(function(results) {
            results.forEach(function(s) { if (s) streams.push(s); });
          });
        })).then(function() { return streams; });
      });
    }).catch(function() { return []; });
}

module.exports = { getStreams: getStreams };
