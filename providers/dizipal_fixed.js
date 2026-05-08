// == DiziPal Nuvio Provider (Tamir Edildi) ==
var BASE_URL = 'https://dizipal.im';
var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9',
    'Referer': BASE_URL + '/'
};
var STREAM_HEADERS = {
    'User-Agent': HEADERS['User-Agent'],
    'Accept': '*/*',
    'Origin': BASE_URL,
    'Referer': BASE_URL + '/'
};

function fetchWithTimeout(url, options, timeout = 10000) {
    return new Promise((resolve, reject) => {
        var timer = setTimeout(() => reject(new Error('Timeout: ' + url)), timeout);
        fetch(url, options)
            .then(r => { clearTimeout(timer); resolve(r); })
            .catch(e => { clearTimeout(timer); reject(e); });
    });
}

// ─── Arama ────────────────────────────────────
function searchDizipal(title, type) {
    var url = BASE_URL + '/?s=' + encodeURIComponent(title);
    return fetchWithTimeout(url, { headers: HEADERS })
        .then(r => r.text())
        .then(html => {
            var results = [];
            var domain = BASE_URL.replace(/\./g, '\\.');
            var re = new RegExp('<a[^>]+href="(' + domain + '/(?:dizi|film|anime)/[^"]+)"[^>]*title="([^"]+)"', 'gi');
            var m;
            while ((m = re.exec(html)) !== null) {
                var isTv = /\/dizi\/|\/anime\//.test(m[1]);
                if (type === 'movie' && isTv) continue;
                if (type === 'tv' && !isTv) continue;
                results.push({ title: m[2], url: m[1], type: isTv ? 'tv' : 'movie' });
            }
            return results;
        });
}

function findBest(results, query) {
    if (!results.length) return null;
    var q = query.toLowerCase();
    var exact = results.find(r => r.title.toLowerCase() === q);
    return exact || results.find(r => r.title.toLowerCase().includes(q)) || results[0];
}

// ─── Bölüm URL'si oluştur ────────────────────
function getEpisodeUrl(contentUrl, s, e) {
    var slug = contentUrl.replace(/\/$/, '').split('/').pop();
    return BASE_URL + '/bolum/' + slug + '-' + s + '-sezon-' + e + '-bolum-izle/';
}

// ─── Sayfadan video kaynağı çıkar (önce doğrudan, yoksa iframe ile) ──
function extractStreamFromPage(url) {
    return fetchWithTimeout(url, { headers: HEADERS })
        .then(r => r.text())
        .then(html => {
            // 1. Direkt master.m3u8 arama (sayfada gömülü olabilir)
            var direct = html.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
            if (direct) {
                return {
                    m3u8: direct[1],
                    subtitle: extractSubtitle(html),
                    origin: BASE_URL
                };
            }

            // 2. Iframe bul
            var iframeMatch = html.match(/<iframe[^>]+src="([^"]+)"/i);
            if (!iframeMatch) {
                // Belki JavaScript ile yükleniyordur, data-src dene
                iframeMatch = html.match(/data-src="([^"]+)"/i);
            }
            if (!iframeMatch) return null;

            var iframeUrl = iframeMatch[1];
            if (!iframeUrl.startsWith('http')) iframeUrl = BASE_URL + iframeUrl;

            return fetchWithTimeout(iframeUrl, { headers: { ...HEADERS, 'Referer': url } })
                .then(r => r.text())
                .then(iframeHtml => {
                    var m3u8 = iframeHtml.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
                    if (!m3u8) {
                        // Bazen file: "..." şeklinde olabilir
                        var fileMatch = iframeHtml.match(/(?:file|src)\s*:\s*["']([^"']+\.m3u8[^"']*)["']/i);
                        if (fileMatch) m3u8 = [null, fileMatch[1]];
                    }
                    if (!m3u8) return null;

                    return {
                        m3u8: m3u8[1],
                        subtitle: extractSubtitle(iframeHtml),
                        origin: new URL(iframeUrl).origin
                    };
                });
        });
}

function extractSubtitle(html) {
    var match = html.match(/"subtitle"\s*:\s*"([^"]+)"/i);
    if (!match) return null;
    var parts = match[1].split(',').map(s => s.trim()).filter(Boolean);
    return parts.map(p => {
        var label = 'TR';
        if (/\[en\]|_eng/i.test(p)) label = 'EN';
        return { label, url: p };
    });
}

// ─── Master m3u8 parse ────────────────────────
function parseMasterM3u8(url, streamHeaders) {
    return fetchWithTimeout(url, { headers: streamHeaders })
        .then(r => r.text())
        .then(data => {
            var lines = data.split('\n');
            var trAudio = null;
            var streams = [];

            for (var i = 0; i < lines.length; i++) {
                var line = lines[i].trim();
                if (line.includes('TYPE=AUDIO') && line.includes('LANGUAGE="tr"')) {
                    var um = line.match(/URI="([^"]+)"/);
                    if (um) trAudio = um[1];
                }
                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    var next = lines[i+1]?.trim();
                    if (!next || next.startsWith('#')) continue;
                    var resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                    var quality = resMatch
                        ? (resMatch[1].startsWith('1920') ? '1080p' :
                           resMatch[1].startsWith('1280') ? '720p' :
                           resMatch[1].startsWith('854')  ? '480p' : '360p')
                        : '720p';
                    var streamUrl = next.startsWith('http') ? next : url.replace(/[^/]+$/, '') + next;
                    streams.push({ url: streamUrl, quality: quality });
                }
            }
            return { streams, trAudio };
        })
        .catch(() => ({ streams: [], trAudio: null }));
}

// ─── Ana getStreams ──────────────────────────
function getStreams(tmdbId, mediaType, season, episode) {
    var tmdbType = mediaType === 'movie' ? 'movie' : 'tv';
    var tmdbUrl = 'https://api.themoviedb.org/3/' + tmdbType + '/' + tmdbId +
        '?api_key=4ef0d7355d9ffb5151e987764708ce96&language=tr-TR';

    return fetch(tmdbUrl).then(r => r.json()).then(data => {
        var title = data.title || data.name || '';
        var origTitle = data.original_title || data.original_name || '';
        if (!title) return [];

        var year = (data.release_date || data.first_air_date || '').substring(0,4);

        var searches = [searchDizipal(title, mediaType)];
        if (origTitle && origTitle !== title) searches.push(searchDizipal(origTitle, mediaType));

        return Promise.all(searches).then(all => {
            var results = all[0].length ? all[0] : (all[1] || []);
            var best = findBest(results, title) || (origTitle ? findBest(results, origTitle) : null);
            if (!best) return [];

            var targetUrl = (mediaType === 'tv' && season && episode)
                ? getEpisodeUrl(best.url, season, episode)
                : best.url;

            return extractStreamFromPage(targetUrl).then(streamData => {
                if (!streamData || !streamData.m3u8) return [];

                var streamHeaders = {
                    ...STREAM_HEADERS,
                    'Referer': (streamData.origin || BASE_URL) + '/',
                    'Origin': streamData.origin || BASE_URL
                };

                return parseMasterM3u8(streamData.m3u8, streamHeaders).then(parsed => {
                    var subs = streamData.subtitle || [];
                    var list = [];

                    if (parsed.trAudio && parsed.streams.length) {
                        parsed.streams.forEach(s => {
                            list.push({
                                name: '⌜ DiziPal ⌟ | TR Dublaj | ' + s.quality,
                                title: title + (year ? ' ('+year+')' : ''),
                                url: s.url,
                                quality: s.quality,
                                headers: streamHeaders,
                                subtitles: subs
                            });
                        });
                    }

                    // Altyazılı orijinal akış
                    list.push({
                        name: '⌜ DiziPal ⌟ | Altyazılı',
                        title: title + (year ? ' ('+year+')' : ''),
                        url: streamData.m3u8,
                        quality: '720p',
                        headers: streamHeaders,
                        subtitles: subs
                    });

                    return list;
                });
            });
        });
    }).catch(err => {
        console.error('[DiziPal]', err);
        return [];
    });
}

// Export
if (typeof module !== 'undefined') module.exports = { getStreams };
else global.getStreams = getStreams;
