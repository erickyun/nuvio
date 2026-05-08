// DiziPal — Nuvio Provider DEBUG / URL-FIXED SAFE VERSION
//
// Bu sürüm yalnızca DiziPal'in mevcut URL yapısına göre dizi/bölüm sayfasını bulur
// ve neden stream çıkmadığını loglar. Telifli/izinsiz kaynaklardan oynatılabilir
// m3u8/mp4 stream URL'si çıkarmaya veya player/API etrafından dolaşmaya yönelik
// kod içermez.
//
// Test edilen gerçek URL kalıpları:
//   https://dizipal.im/dizi/gassal/
//   https://dizipal.im/bolum/gassal-1-sezon-1-bolum-izle/
//   https://dizipal.im/dizi/gibi/
//   https://dizipal.im/bolum/gibi-1-sezon-1-bolum-izle/

var TMDB_API_KEY = '500330721680edb6d5f7f12ba7cd9023';
var BASE_URL = 'https://dizipal.im';
var FETCH_TIMEOUT_MS = 10000;
var PROVIDER_NAME = 'DiziPal-Debug';

var HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
  'Referer': BASE_URL + '/'
};

function log(msg) {
  try { console.log('[' + PROVIDER_NAME + '] ' + msg); } catch (_) {}
}

function warn(msg) {
  try { console.warn('[' + PROVIDER_NAME + '] ' + msg); } catch (_) { log('WARN: ' + msg); }
}

function fetchWithTimeout(url, options) {
  options = options || {};
  return new Promise(function(resolve, reject) {
    var done = false;
    var t = setTimeout(function() {
      if (done) return;
      done = true;
      reject(new Error('Timeout: ' + url));
    }, FETCH_TIMEOUT_MS);

    fetch(url, options)
      .then(function(r) {
        if (done) return;
        done = true;
        clearTimeout(t);
        resolve(r);
      })
      .catch(function(e) {
        if (done) return;
        done = true;
        clearTimeout(t);
        reject(e);
      });
  });
}

function fetchText(url, referer) {
  return fetchWithTimeout(url, {
    headers: Object.assign({}, HEADERS, { 'Referer': referer || BASE_URL + '/' })
  }).then(function(r) {
    log('GET ' + url + ' => HTTP ' + r.status);
    if (!r.ok) throw new Error('HTTP ' + r.status + ' for ' + url);
    return r.text();
  });
}

function fetchJson(url) {
  return fetchWithTimeout(url, {
    headers: { 'Accept': 'application/json' }
  }).then(function(r) {
    if (!r.ok) throw new Error('TMDB HTTP ' + r.status);
    return r.json();
  });
}

function htmlDecode(s) {
  return String(s || '')
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function titleToSlug(title) {
  return String(title || '')
    .toLowerCase()
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function normalizeTitle(title) {
  return titleToSlug(htmlDecode(title)).replace(/-/g, ' ').trim();
}

function absUrl(url) {
  if (!url) return '';
  if (/^https?:\/\//i.test(url)) return url;
  if (url.charAt(0) === '/') return BASE_URL + url;
  return BASE_URL + '/' + url;
}

function uniqueByUrl(list) {
  var seen = {};
  var out = [];
  for (var i = 0; i < list.length; i++) {
    var u = list[i] && list[i].url;
    if (!u || seen[u]) continue;
    seen[u] = true;
    out.push(list[i]);
  }
  return out;
}

function fetchTmdbInfo(tmdbId, mediaType) {
  var endpoint = mediaType === 'movie' ? 'movie' : 'tv';
  var url = 'https://api.themoviedb.org/3/' + endpoint + '/' + tmdbId +
    '?api_key=' + encodeURIComponent(TMDB_API_KEY) + '&language=tr-TR';

  return fetchJson(url).then(function(d) {
    return {
      titleTr: d.title || d.name || '',
      titleEn: d.original_title || d.original_name || '',
      year: String(d.release_date || d.first_air_date || '').slice(0, 4)
    };
  });
}

function searchDiziPal(query, mediaType) {
  var url = BASE_URL + '/?s=' + encodeURIComponent(query);
  log('Arama: ' + url);

  return fetchText(url, BASE_URL + '/')
    .then(function(html) {
      var results = [];
      var re = /<a[^>]+href=["']([^"']+)["'][^>]*title=["']([^"']+)["']/gi;
      var m;

      while ((m = re.exec(html)) !== null) {
        var href = absUrl(htmlDecode(m[1]));
        var title = htmlDecode(m[2]);

        var isTv = href.indexOf('/dizi/') !== -1 || href.indexOf('/anime/') !== -1;
        var isMovie = href.indexOf('/film/') !== -1 || /^https?:\/\/[^/]+\/[a-z0-9-]+\/?$/i.test(href);

        if (mediaType === 'tv' && !isTv) continue;
        if (mediaType === 'movie' && isTv) continue;

        if (href.indexOf(BASE_URL) === 0) {
          results.push({ title: title, url: href, type: isTv ? 'tv' : 'movie' });
        }
      }

      results = uniqueByUrl(results);
      log('Arama sonucu sayısı: ' + results.length);
      for (var i = 0; i < Math.min(results.length, 5); i++) {
        log('Sonuç ' + (i + 1) + ': ' + results[i].title + ' => ' + results[i].url);
      }
      return results;
    })
    .catch(function(e) {
      warn('Arama hata: ' + e.message);
      return [];
    });
}

function scoreResult(result, titleTr, titleEn) {
  var rt = normalizeTitle(result.title);
  var tr = normalizeTitle(titleTr);
  var en = normalizeTitle(titleEn);

  if (tr && rt === tr) return 100;
  if (en && rt === en) return 95;
  if (tr && rt.indexOf(tr) !== -1) return 80;
  if (en && rt.indexOf(en) !== -1) return 75;
  if (tr && tr.indexOf(rt) !== -1) return 60;
  if (en && en.indexOf(rt) !== -1) return 55;
  return 1;
}

function pickBestResult(results, titleTr, titleEn) {
  if (!results || !results.length) return null;
  var best = results[0];
  var bestScore = scoreResult(best, titleTr, titleEn);

  for (var i = 1; i < results.length; i++) {
    var s = scoreResult(results[i], titleTr, titleEn);
    if (s > bestScore) {
      best = results[i];
      bestScore = s;
    }
  }

  log('En iyi eşleşme: ' + best.title + ' | skor=' + bestScore + ' | ' + best.url);
  return best;
}

function buildSeriesUrlFromSlug(slug) {
  return BASE_URL + '/dizi/' + slug + '/';
}

function buildEpisodeUrlFromSlug(slug, season, episode) {
  return BASE_URL + '/bolum/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/';
}

function slugFromSeriesUrl(url) {
  var m = String(url || '').match(/\/dizi\/([^/?#]+)\/?/i);
  return m ? m[1] : '';
}

function verifyPage(url) {
  return fetchText(url, BASE_URL + '/')
    .then(function(html) {
      return { url: url, html: html, ok: true };
    })
    .catch(function(e) {
      warn('Sayfa doğrulanamadı: ' + url + ' | ' + e.message);
      return null;
    });
}

function resolveSeriesPage(info, mediaType) {
  if (mediaType !== 'tv') {
    return searchDiziPal(info.titleTr || info.titleEn, mediaType).then(function(results) {
      return pickBestResult(results, info.titleTr, info.titleEn);
    });
  }

  var slugs = [];
  var slugTr = titleToSlug(info.titleTr);
  var slugEn = titleToSlug(info.titleEn);
  if (slugTr) slugs.push(slugTr);
  if (slugEn && slugEn !== slugTr) slugs.push(slugEn);

  function tryDirect(i) {
    if (i >= slugs.length) return Promise.resolve(null);
    var url = buildSeriesUrlFromSlug(slugs[i]);
    log('Direkt dizi sayfası deneniyor: ' + url);
    return verifyPage(url).then(function(res) {
      if (res && /\/bolum\//i.test(res.html)) {
        return { title: info.titleTr || info.titleEn, url: url, type: 'tv', html: res.html };
      }
      return tryDirect(i + 1);
    });
  }

  return tryDirect(0).then(function(found) {
    if (found) return found;

    var queries = [];
    if (info.titleTr) queries.push(info.titleTr);
    if (info.titleEn && info.titleEn !== info.titleTr) queries.push(info.titleEn);

    var promises = queries.map(function(q) { return searchDiziPal(q, mediaType); });
    return Promise.all(promises).then(function(all) {
      var merged = [];
      all.forEach(function(list) { merged = merged.concat(list || []); });
      merged = uniqueByUrl(merged);
      return pickBestResult(merged, info.titleTr, info.titleEn);
    });
  });
}

function extractEpisodeLinksFromSeriesHtml(html) {
  var links = [];
  var re = /<a[^>]+href=["']([^"']*\/bolum\/[^"']+)["'][^>]*>/gi;
  var m;
  while ((m = re.exec(html)) !== null) {
    links.push(absUrl(htmlDecode(m[1])));
  }
  var seen = {};
  return links.filter(function(u) {
    if (seen[u]) return false;
    seen[u] = true;
    return true;
  });
}

function resolveEpisodePage(series, season, episode) {
  var slug = slugFromSeriesUrl(series.url);
  var directUrl = slug ? buildEpisodeUrlFromSlug(slug, season, episode) : '';

  if (directUrl) {
    log('Direkt bölüm URL deneniyor: ' + directUrl);
    return verifyPage(directUrl).then(function(res) {
      if (res) return res;
      return null;
    });
  }

  return verifyPage(series.url).then(function(res) {
    if (!res) return null;
    var links = extractEpisodeLinksFromSeriesHtml(res.html);
    var needle = '-' + season + '-sezon-' + episode + '-bolum-izle/';
    for (var i = 0; i < links.length; i++) {
      if (links[i].indexOf(needle) !== -1) return verifyPage(links[i]);
    }
    return null;
  });
}

function inspectForPublicPlayer(html) {
  var report = {
    hasIframe: /<iframe\b/i.test(html),
    hasPlayer: /player|video-player-area|responsive-player/i.test(html),
    hasM3u8: /\.m3u8/i.test(html),
    hasMp4: /\.mp4/i.test(html),
    iframeUrls: []
  };

  var iframeRe = /<iframe[^>]+src=["']([^"']+)["']/gi;
  var m;
  while ((m = iframeRe.exec(html)) !== null) {
    report.iframeUrls.push(absUrl(htmlDecode(m[1])));
  }

  return report;
}

function getStreams(tmdbId, mediaType, seasonNum, episodeNum) {
  log('Başladı | tmdbId=' + tmdbId + ' | mediaType=' + mediaType + (mediaType === 'tv' ? ' | S' + seasonNum + 'E' + episodeNum : ''));

  return fetchTmdbInfo(tmdbId, mediaType)
    .then(function(info) {
      log('TMDB: TR="' + info.titleTr + '" EN="' + info.titleEn + '" YEAR=' + info.year);

      return resolveSeriesPage(info, mediaType).then(function(series) {
        if (!series || !series.url) {
          warn('Dizi/film sayfası bulunamadı.');
          return [];
        }

        if (mediaType !== 'tv') {
          warn('Bu debug sürümü film stream çıkarmıyor. Bulunan sayfa: ' + series.url);
          return [];
        }

        return resolveEpisodePage(series, seasonNum, episodeNum).then(function(ep) {
          if (!ep || !ep.html) {
            warn('Bölüm sayfası bulunamadı.');
            return [];
          }

          log('Bölüm sayfası bulundu: ' + ep.url);

          var report = inspectForPublicPlayer(ep.html);
          log('Sayfa analizi: iframe=' + report.hasIframe + ', player=' + report.hasPlayer + ', m3u8=' + report.hasM3u8 + ', mp4=' + report.hasMp4 + ', iframeSayısı=' + report.iframeUrls.length);

          if (report.iframeUrls.length) {
            report.iframeUrls.forEach(function(u, idx) {
              log('iframe[' + idx + ']: ' + u);
            });
          }

          warn('Bu sayfanın düz HTML cevabında herkese açık oynatılabilir stream bulunamadı veya bu sürümde çıkarılmıyor. getStreams güvenli olarak [] döndürüyor.');
          return [];
        });
      });
    })
    .catch(function(err) {
      warn('Genel hata: ' + (err && err.message ? err.message : String(err)));
      return [];
    });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { getStreams: getStreams };
} else {
  global.getStreams = getStreams;
}
