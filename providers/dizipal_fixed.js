// ============================================================
// Dizilla / modern route patch
// /dizi/gassal/
// /bolum/gassal-1-sezon-1-bolum-izle/
// ============================================================

// Domaini kendin yaz. Sonda / olmasın.
var BASE_URL = 'https://dizipal.im';

function getDomain() {
  if (!BASE_URL) {
    throw new Error('BASE_URL boş. Gerçek domaini BASE_URL içine yaz.');
  }
  BASE_URL = BASE_URL.replace(/\/+$/, '');
  return Promise.resolve(BASE_URL);
}

function htmlDecode(str) {
  if (!str) return '';
  return String(str)
    .replace(/&amp;/g, '&')
    .replace(/&#038;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&#039;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>');
}

function normalizeUrl(url, base) {
  if (!url) return '';

  url = htmlDecode(String(url).trim());

  if (!url || url === '#' || /^javascript:/i.test(url)) return '';

  if (url.startsWith('//')) {
    return 'https:' + url;
  }

  if (url.startsWith('/')) {
    return base.replace(/\/+$/, '') + url;
  }

  try {
    return new URL(url, base).href;
  } catch (e) {
    return url;
  }
}

function titleToSlug(title) {
  return (title || '')
    .toString()
    .trim()
    .toLowerCase()
    .replace(/ı/g, 'i')
    .replace(/İ/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Dizi ana sayfası: /dizi/gassal/
function findContentPage(titleTr, titleEn, mediaType, base) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);

  var candidates = [];

  if (mediaType === 'tv') {
    if (slugTr) candidates.push(base + '/dizi/' + slugTr + '/');
    if (slugEn && slugEn !== slugTr) candidates.push(base + '/dizi/' + slugEn + '/');

    // Bazı siteler çoğul kullanabiliyor
    if (slugTr) candidates.push(base + '/diziler/' + slugTr + '/');
    if (slugEn && slugEn !== slugTr) candidates.push(base + '/diziler/' + slugEn + '/');
  } else {
    if (slugTr) candidates.push(base + '/film/' + slugTr + '/');
    if (slugEn && slugEn !== slugTr) candidates.push(base + '/film/' + slugEn + '/');

    if (slugTr) candidates.push(base + '/filmler/' + slugTr + '/');
    if (slugEn && slugEn !== slugTr) candidates.push(base + '/filmler/' + slugEn + '/');
  }

  function tryNext(i) {
    if (i >= candidates.length) return Promise.resolve(null);

    var url = candidates[i];

    return fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    })
      .then(function (r) {
        if (!r.ok || r.status === 404) return tryNext(i + 1);

        return r.text().then(function (html) {
          var looksValid =
            html.indexOf('/bolum/') !== -1 ||
            html.indexOf('iframe') !== -1 ||
            html.indexOf('player') !== -1 ||
            html.indexOf('data-src') !== -1 ||
            html.indexOf('data-id') !== -1;

          if (!looksValid) return tryNext(i + 1);

          return {
            url: url,
            html: html
          };
        });
      })
      .catch(function () {
        return tryNext(i + 1);
      });
  }

  return tryNext(0);
}

// Bölüm URL adayları
function buildEpisodeCandidates(base, slug, season, episode) {
  return [
    base + '/bolum/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle/',
    base + '/bolum/' + slug + '-' + season + '-sezon-' + episode + '-bolum-izle',
    base + '/bolum/' + slug + '-' + season + '-sezon-' + episode + '-bolum/',
    base + '/bolum/' + slug + '-' + season + '-sezon-' + episode + '-bolum',
    base + '/dizi/' + slug + '/' + season + '-sezon-' + episode + '-bolum/',
    base + '/dizi/' + slug + '/sezon-' + season + '/bolum-' + episode + '/'
  ];
}

// Dizi bölümü: /bolum/gassal-1-sezon-1-bolum-izle/
function fetchEpisodePage(base, titleTr, titleEn, season, episode) {
  var slugTr = titleToSlug(titleTr);
  var slugEn = titleToSlug(titleEn);

  var candidates = [];

  if (slugTr) {
    candidates = candidates.concat(buildEpisodeCandidates(base, slugTr, season, episode));
  }

  if (slugEn && slugEn !== slugTr) {
    candidates = candidates.concat(buildEpisodeCandidates(base, slugEn, season, episode));
  }

  function tryNext(i) {
    if (i >= candidates.length) return Promise.resolve(null);

    var url = candidates[i];

    return fetch(url, {
      headers: {
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
      }
    })
      .then(function (r) {
        if (!r.ok || r.status === 404) return tryNext(i + 1);

        return r.text().then(function (html) {
          var id = parseContentId(html);

          return {
            id: id,
            html: html,
            url: url
          };
        });
      })
      .catch(function () {
        return tryNext(i + 1);
      });
  }

  return tryNext(0);
}

// Daha geniş ID yakalama
function parseContentId(html) {
  var patterns = [
    /data-id=["']?(\d+)["']?/i,
    /data-post-id=["']?(\d+)["']?/i,
    /data-episode-id=["']?(\d+)["']?/i,
    /episode[_-]?id["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /post[_-]?id["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /player[_-]?id["']?\s*[:=]\s*["']?(\d+)["']?/i,
    /["']id["']\s*:\s*["']?(\d+)["']?/i
  ];

  for (var i = 0; i < patterns.length; i++) {
    var m = html.match(patterns[i]);
    if (m) return m[1];
  }

  return null;
}

function isLikelyEmbedUrl(url, base) {
  if (!url) return false;

  // Aynı domaindeki player/embed/ajax yolları olabilir.
  if (url.indexOf(base) === 0) {
    return /\/(embed|player|iframe|play|watch|video|ajax|kaynak|source)/i.test(url);
  }

  // Harici iframe/player provider kontrolü
  var providers = [
    'rapidvid',
    'turkeyplayer',
    'dplayer',
    'hotstream',
    'vidmoly',
    'filemoon',
    'odnoklassniki',
    'ok.ru',
    'gdplayer',
    'pichive',
    'vidmoxy',
    'playru',
    'drive.google',
    'sibnet',
    'uqload',
    'dood',
    'streamtape',
    'mixdrop'
  ];

  var lower = url.toLowerCase();

  return providers.some(function (p) {
    return lower.indexOf(p) !== -1;
  }) || /\/(embed|player|iframe|watch|video|play)\//i.test(url);
}

function getAttr(tag, attr) {
  var re = new RegExp('\\b' + attr + '\\s*=\\s*["\\']([^"\\']+)["\\']', 'i');
  var m = tag.match(re);
  return m ? htmlDecode(m[1]) : '';
}

// Bozuk iframe regex yerine bunu kullan
function extractEmbedLinks(html, pageUrl, base) {
  var embeds = [];
  var seen = {};

  function push(rawUrl, dil) {
    var url = normalizeUrl(rawUrl, base);

    if (!url) return;
    if (seen[url]) return;
    if (!isLikelyEmbedUrl(url, base)) return;

    seen[url] = true;

    embeds.push({
      url: url,
      dil: dil || guessDil(url, html)
    });
  }

  // 1) iframe src / data-src / lazy src
  var iframeTagPattern = /<iframe\b[^>]*>/gi;
  var m;

  while ((m = iframeTagPattern.exec(html)) !== null) {
    var tag = m[0];

    [
      'src',
      'data-src',
      'data-lazy-src',
      'data-original',
      'data-url',
      'data-iframe',
      'data-embed'
    ].forEach(function (attr) {
      var val = getAttr(tag, attr);
      if (val) push(val, guessDil(val, tag));
    });
  }

  // 2) genel data-* veya href kaynakları
  var attrPattern = /\b(?:data-src|data-lazy-src|data-original|data-url|data-iframe|data-embed|href)\s*=\s*["']([^"']+)["']/gi;

  while ((m = attrPattern.exec(html)) !== null) {
    push(m[1], guessDil(m[1], html));
  }

  // 3) JS içinde iframe/embed url stringleri
  var jsUrlPattern = /["']((?:https?:)?\/\/[^"']+(?:embed|player|iframe|watch|video|play)[^"']*)["']/gi;

  while ((m = jsUrlPattern.exec(html)) !== null) {
    push(m[1], guessDil(m[1], html));
  }

  // 4) escaped slash formatı
  var escapedPattern = /https?:\\\/\\\/[^"']+/gi;

  while ((m = escapedPattern.exec(html)) !== null) {
    var clean = m[0].replace(/\\\//g, '/');
    push(clean, guessDil(clean, html));
  }

  return embeds;
}

function guessDil(url, context) {
  var text = ((url || '') + ' ' + (context || '')).toLowerCase();

  if (
    text.indexOf('dublaj') !== -1 ||
    text.indexOf('tr-dublaj') !== -1 ||
    text.indexOf('turkce-dublaj') !== -1
  ) {
    return 'TR Dublaj';
  }

  if (
    text.indexOf('altyazi') !== -1 ||
    text.indexOf('altyazı') !== -1 ||
    text.indexOf('sub') !== -1
  ) {
    return 'TR Altyazı';
  }

  return 'TR';
}

// Multiplayer / player sayfası varsa iframeleri oradan tekrar çek
function resolveMultiplayerEmbeds(mpUrl, base) {
  return fetch(mpUrl, {
    headers: {
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7'
    }
  })
    .then(function (r) {
      if (!r.ok) return [];
      return r.text();
    })
    .then(function (html) {
      return extractEmbedLinks(html, mpUrl, base);
    })
    .catch(function () {
      return [];
    });
}
