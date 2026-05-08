// DiziPal Provider — Son Yapıya Uygun Tamir Edilmiş Sürüm
var BASE_URL = 'https://dizipal.im';
var FETCH_TIMEOUT = 10000;

var HEADERS = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
    'Accept-Language': 'tr-TR,tr;q=0.9',
    'Referer': BASE_URL + '/'
};

function fetchWithTimeout(url, opts) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('Timeout: ' + url)), FETCH_TIMEOUT);
        fetch(url, opts)
            .then(r => { clearTimeout(timer); resolve(r); })
            .catch(e => { clearTimeout(timer); reject(e); });
    });
}

// ---------- Yardımcılar ----------
function extractM3u8Direct(html) {
    // 1. doğrudan master.m3u8 içeren linkler
    let m = html.match(/(https?:\/\/[^\s"']+master\.m3u8[^\s"']*)/i);
    if (m) return m[1];
    // 2. JSON / player ayarları içinde
    m = html.match(/(?:source|file|src)\s*[:=]\s*["']([^"']+\.m3u8[^"']*)["']/i);
    return m ? m[1] : null;
}

function extractSubtitle(html, base) {
    let m = html.match(/["']subtitle["']\s*:\s*["']([^"']+)["']/i);
    if (!m) return null;
    let subs = [];
    m[1].split(',').forEach(part => {
        part = part.trim();
        if (!part) return;
        let label = 'TR';
        if (part.includes('[en]') || part.includes('_eng')) label = 'EN';
        if (part.includes('[tr]') || part.includes('_tur')) label = 'TR';
        subs.push({ label, url: part.startsWith('http') ? part : base + part });
    });
    return subs.length ? subs : null;
}

function parseMaster(m3u8Url, streamHeaders) {
    return fetchWithTimeout(m3u8Url, { headers: streamHeaders })
        .then(r => r.text())
        .then(data => {
            const lines = data.split('\n');
            let trAudio = null;
            const streams = [];

            for (let i = 0; i < lines.length; i++) {
                const line = lines[i].trim();
                if (line.includes('TYPE=AUDIO') && line.includes('LANGUAGE="tr"')) {
                    const um = line.match(/URI="([^"]+)"/);
                    if (um) trAudio = um[1];
                }
                if (line.startsWith('#EXT-X-STREAM-INF:')) {
                    const url = lines[i + 1]?.trim();
                    if (!url || url.startsWith('#')) continue;
                    const resMatch = line.match(/RESOLUTION=(\d+x\d+)/);
                    const quality = resMatch
                        ? (resMatch[1].startsWith('1920') ? '1080p' :
                           resMatch[1].startsWith('1280') ? '720p' :
                           resMatch[1].startsWith('854')  ? '480p' : '360p')
                        : '720p';
                    const fullUrl = url.startsWith('http') ? url : m3u8Url.replace(/[^/]+$/, '') + url;
                    streams.push({ url: fullUrl, quality });
                }
            }
            return { streams, trAudio };
        })
        .catch(() => ({ streams: [], trAudio: null }));
}

// ---------- Arama ----------
function searchDizipal(title, type) {
    const url = BASE_URL + '/?s=' + encodeURIComponent(title);
    return fetchWithTimeout(url, { headers: HEADERS })
        .then(r => r.text())
        .then(html => {
            const results = [];
            const domain = BASE_URL.replace(/\./g, '\\.');
            const re = new RegExp('<a[^>]+href="(' + domain + '/(?:dizi|film|anime)/[^"]+)"[^>]*title="([^"]+)"', 'gi');
            let m;
            while ((m = re.exec(html)) !== null) {
                const isTv = m[1].includes('/dizi/') || m[1].includes('/anime/');
                if (type === 'movie' && isTv) continue;
                if (type === 'tv' && !isTv) continue;
                if (!results.some(r => r.url === m[1]))
                    results.push({ title: m[2], url: m[1], type: isTv ? 'tv' : 'movie' });
            }
            return results;
        });
}

function bestMatch(results, query) {
    if (!results.length) return null;
    const q = query.toLowerCase();
    const exact = results.find(r => r.title.toLowerCase() === q);
    if (exact) return exact;
    const partial = results.find(r => r.title.toLowerCase().includes(q));
    return partial || results[0];
}

// ---------- İçerik sayfası & m3u8 bulma ----------
function getEpisodeUrl(contentUrl, season, episode) {
    const slug = contentUrl.replace(/\/$/, '').split('/').pop();
    return `${BASE_URL}/bolum/${slug}-${season}-sezon-${episode}-bolum-izle/`;
}

function loadIframeAndM3u8(pageUrl) {
    return fetchWithTimeout(pageUrl, { headers: HEADERS })
        .then(r => r.text())
        .then(html => {
            // 1. Doğrudan m3u8 var mı?
            let directM3u8 = extractM3u8Direct(html);
            if (directM3u8) return { url: directM3u8, iframeOrigin: BASE_URL, subs: extractSubtitle(html, BASE_URL) };

            // 2. iframe src bul
            const iframePatterns = [
                /<iframe[^>]+src="([^"]+)"/gi,
                /\$\(['"]#player['"]\)\.html\(['"]<iframe[^>]+src="([^"]+)/gi,
                /src=["'](https?:\/\/[^"']+embed[^"']+)["']/gi,
                /data-src=["']([^"']+)["']/gi
            ];
            let iframeSrc = null;
            for (const pat of iframePatterns) {
                const m = pat.exec(html);
                if (m) { iframeSrc = m[1]; break; }
            }
            if (!iframeSrc) return null;

            // iframe sayfasını çek
            const origin = new URL(iframeSrc).origin;
            return fetchWithTimeout(iframeSrc, { headers: { ...HEADERS, Referer: BASE_URL + '/' } })
                .then(r => r.text())
                .then(iframeHtml => {
                    const m3u8 = extractM3u8Direct(iframeHtml);
                    if (!m3u8) return null;
                    return {
                        url: m3u8,
                        iframeOrigin: origin,
                        subs: extractSubtitle(iframeHtml, origin)
                    };
                });
        });
}

// ---------- Ana akış sağlayıcı ----------
function getStreams(tmdbId, mediaType, season, episode) {
    const typePath = mediaType === 'movie' ? 'movie' : 'tv';
    const tmdbUrl = `https://api.themoviedb.org/3/${typePath}/${tmdbId}?api_key=4ef0d7355d9ffb5151e987764708ce96&language=tr-TR`;

    return fetchWithTimeout(tmdbUrl, {})
        .then(r => r.json())
        .then(data => {
            const title = data.title || data.name || '';
            const origTitle = data.original_title || data.original_name || '';
            const year = (data.release_date || data.first_air_date || '').substring(0, 4);
            if (!title) return [];

            const searches = [searchDizipal(title, mediaType)];
            if (origTitle && origTitle !== title) searches.push(searchDizipal(origTitle, mediaType));

            return Promise.all(searches).then(all => {
                let results = all[0];
                if (!results.length && all[1]) results = all[1];
                const best = bestMatch(results, title) || bestMatch(results, origTitle);
                if (!best) return [];

                const finalUrl = mediaType === 'tv' && season && episode
                    ? getEpisodeUrl(best.url, season, episode)
                    : best.url;

                return loadIframeAndM3u8(finalUrl).then(streamData => {
                    if (!streamData || !streamData.url) return [];

                    const streamHeaders = {
                        ...HEADERS,
                        Referer: (streamData.iframeOrigin || BASE_URL) + '/',
                        Origin: streamData.iframeOrigin || BASE_URL
                    };

                    return parseMaster(streamData.url, streamHeaders).then(parsed => {
                        const list = [];
                        const subs = streamData.subs || [];

                        if (parsed.trAudio && parsed.streams.length) {
                            parsed.streams.forEach(s => {
                                list.push({
                                    name: `⌜ DiziPal ⌟ | TR Dublaj | ${s.quality}`,
                                    title: `${title}${year ? ' ('+year+')' : ''}`,
                                    url: s.url,
                                    quality: s.quality,
                                    headers: streamHeaders,
                                    subtitles: subs
                                });
                            });
                        }

                        // Orijinal altyazılı akış
                        list.push({
                            name: '⌜ DiziPal ⌟ | Altyazılı',
                            title: `${title}${year ? ' ('+year+')' : ''}`,
                            url: streamData.url,
                            quality: '720p',
                            headers: streamHeaders,
                            subtitles: subs
                        });

                        return list;
                    });
                });
            });
        })
        .catch(err => {
            console.error('[DiziPal]', err);
            return [];
        });
}

if (typeof module !== 'undefined') module.exports = { getStreams };
else global.getStreams = getStreams;
