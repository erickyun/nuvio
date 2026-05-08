/*
 * Dizipal Provider for Nuvio
 * Fixed & Enhanced Version
 * Author: Assistant
 * Date: 2024
 */

const axios = require('axios');
const cheerio = require('cheerio');
const { load } = cheerio;

class DizipalProvider {
    constructor() {
        this.id = 'dizipal';
        this.name = 'Dizipal';
        this.baseURL = 'https://dizipal.im';
        this.headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
            'Accept-Language': 'tr-TR,tr;q=0.9,en-US;q=0.8,en;q=0.7',
            'Referer': this.baseURL,
        };
    }

    /**
     * Ana sayfa veya dizi sayfasından bölüm listesi çek
     */
    async getEpisodeList(url) {
        try {
            const response = await axios.get(url, {
                headers: this.headers,
                timeout: 15000
            });
            
            const $ = load(response.data);
            const episodes = [];

            // Bölüm listesini farklı selector'larla dene
            const selectors = [
                '.episode-list .episode-item',
                '.episodes .episode',
                '.bolum-listesi .bolum',
                '[data-episode]',
                '.season-episodes a'
            ];

            for (const selector of selectors) {
                $(selector).each((index, element) => {
                    const $el = $(element);
                    const episodeUrl = $el.attr('href') || $el.data('href') || $el.find('a').attr('href');
                    const episodeNum = $el.find('.episode-num, .bolum-no, .number').text().trim() || (index + 1).toString();
                    const title = $el.find('.title, .bolum-baslik, h3, h4').text().trim() || `Bölüm ${episodeNum}`;

                    if (episodeUrl && !episodes.find(e => e.url === episodeUrl)) {
                        episodes.push({
                            url: this.resolveURL(episodeUrl),
                            episode: parseInt(episodeNum) || index + 1,
                            title: title
                        });
                    }
                });

                if (episodes.length > 0) break;
            }

            return {
                success: true,
                data: episodes
            };

        } catch (error) {
            console.error('[Dizipal] Episode list error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Bölüm sayfasından video kaynaklarını çek - ANA FONKSİYON
     */
    async getVideoSources(episodeUrl) {
        try {
            console.log(`[Dizipal] Fetching episode: ${episodeUrl}`);
            
            // 1. Bölüm sayfasını getir
            const pageResponse = await axios.get(episodeUrl, {
                headers: this.headers,
                timeout: 20000,
                maxRedirects: 5
            });

            const $ = load(pageResponse.data);
            const sources = [];

            // 2. Video player container'ını bul (çoklu yöntem)
            const playerData = await this.extractPlayerData($, episodeUrl);
            
            if (playerData && playerData.sources) {
                sources.push(...playerData.sources);
            }

            // 3. Alternatif: Embed/iframe URL'lerinden video çıkar
            const embedSources = await this.extractFromEmbeds($, episodeUrl);
            if (embedSources.length > 0) {
                sources.push(...embedSources);
            }

            // 4. Sayfa kaynağından doğrudan m3u8/mp4 URL'leri ara
            const directSources = this.extractDirectURLs(pageResponse.data, episodeUrl);
            if (directSources.length > 0) {
                sources.push(...directSources);
            }

            // Tekrarları temizle
            const uniqueSources = this.deduplicateSources(sources);

            console.log(`[Dizipal] Found ${uniqueSources.length} sources`);

            return {
                success: true,
                data: uniqueSources,
                url: episodeUrl
            };

        } catch (error) {
            console.error('[Dizipal] Video source error:', error.message);
            return { success: false, error: error.message };
        }
    }

    /**
     * Player container'dan video verisi çıkar
     */
    async extractPlayerData($, referer) {
        const result = { sources: [] };

        // Yöntem 1: JSON-LD veya script tag'leri içindeki veri
        $('script').each((idx, el) => {
            const content = $(el).html() || '';
            
            // JSON formatında video verisi ara
            const jsonPatterns = [
                /["']?sources["']?\s*:\s*(\[[^\]]+\])/g,
                /["']?file["']?\s*:\s*["']([^"']+\.m3u8[^"']*)["']/g,
                /["']?src["']?\s*:\s*["']([^"']+(?:m3u8|mp4)[^"']*)["']/g,
                /["']?video_url["']?\s*:\s*["']([^"']+)["']/g,
                /["']?stream_url["']?\s*:\s*["']([^"']+)["']/g
            ];

            for (const pattern of jsonPatterns) {
                let match;
                while ((match = pattern.exec(content)) !== null) {
                    try {
                        const data = match[1];
                        if (data.startsWith('[')) {
                            const parsed = JSON.parse(data.replace(/'/g, '"'));
                            parsed.forEach(src => {
                                if (src.file || src.src || src.url) {
                                    result.sources.push({
                                        url: src.file || src.src || src.url,
                                        type: src.type || this.detectFileType(src.file || src.src || src.url),
                                        quality: src.quality || src.label || 'auto',
                                        server: src.server || 'main'
                                    });
                                }
                            });
                        } else if (data.includes('m3u8') || data.includes('mp4')) {
                            result.sources.push({
                                url: data,
                                type: this.detectFileType(data),
                                quality: 'auto',
                                server: 'extracted'
                            });
                        }
                    } catch (e) {}
                }
            }
        });

        // Yöntem 2: Data attribute'larından
        const playerSelectors = [
            '#player', '.player', '.video-player', '#videoPlayer',
            '[data-video]', '[data-source]', '[data-url]',
            '.jwplayer', '.videojs', '#hls-player'
        ];

        for (const selector of playerSelectors) {
            const $player = $(selector).first();
            if ($player.length) {
                const dataVideo = $player.data('video') || $player.data('source') || $player.data('url') || $player.data('src');
                if (dataVideo) {
                    if (typeof dataVideo === 'string') {
                        result.sources.push({
                            url: dataVideo,
                            type: this.detectFileType(dataVideo),
                            quality: 'data-attr',
                            server: 'player-data'
                        });
                    } else if (Array.isArray(dataVideo)) {
                        dataVideo.forEach(src => {
                            result.sources.push({
                                url: src.file || src.src || src,
                                type: this.detectFileType(src.file || src.src || src),
                                quality: src.quality || 'auto',
                                server: 'player-array'
                            });
                        });
                    }
                }
            }
        }

        // Yöntem 3: Meta tags
        $('meta[property="og:video"], meta[name="video:url"], meta[name="twitter:player:stream"]').each((idx, el) => {
            const content = $(el).attr('content');
            if (content && (content.includes('.m3u8') || content.includes('.mp4'))) {
                result.sources.push({
                    url: content,
                    type: this.detectFileType(content),
                    quality: 'meta',
                    server: 'og-meta'
                });
            }
        });

        return result;
    }

    /**
     * Iframe/embed URL'lerinden video kaynakları çıkar
     */
    async extractFromEmbeds($, referer) {
        const sources = [];
        const embedUrls = new Set();

        // Tüm iframe'leri topla
        $('iframe').each((idx, el) => {
            const src = $(el).attr('src') || $(el).attr('data-src');
            if (src && !src.includes('advertisement') && !src.includes('ads')) {
                embedUrls.add(this.resolveURL(src));
            }
        });

        // Embed container'larından URL çıkar
        $('.embed-container, .video-embed, [data-embed], .source-item').each((idx, el) => {
            const $el = $(el);
            const src = $el.attr('data-src') || $el.attr('data-url') || $el.attr('href') || $el.find('iframe').attr('src');
            if (src) embedUrls.add(this.resolveURL(src));
        });

        // Her embed URL'sinden video çıkar
        for (const embedUrl of embedUrls) {
            try {
                const embedSources = await this.extractFromSingleEmbed(embedUrl, referer);
                sources.push(...embedSources);
            } catch (e) {
                console.log(`[Dizipal] Embed extract failed: ${embedUrl}`, e.message);
            }
        }

        return sources;
    }

    /**
     * Tekil embed URL'den video çıkar
     */
    async extractFromSingleEmbed(embedUrl, parentReferer) {
        const sources = [];
        
        try {
            const headers = {
                ...this.headers,
                'Referer': parentReferer || this.baseURL
            };

            const response = await axios.get(embedUrl, {
                headers,
                timeout: 10000,
                maxRedirects: 5
            });

            const html = response.data;
            const finalUrl = response.request.res.responseUrl || embedUrl;

            // HTML içeriğinde m3u8/mp4 ara
            const patterns = [
                /(?:https?:)?\/\/[^"'\s<>]+\.m3u8[^"'\s]*/gi,
                /(?:https?:)?\/\/[^"'\s<>]+\.mp4[^"'\s]*/gi,
                /["']?(?:file|src|url|source)["']?\s*[:=]\s*["']([^"']+(?:m3u8|mp4)[^"']*)["']/gi,
                /source\s+src=["']([^"']+)["']/gi
            ];

            for (const pattern of patterns) {
                let match;
                while ((match = pattern.exec(html)) !== null) {
                    let url = match[1] || match[0];
                    
                    // Protokol ekle
                    if (url.startsWith('//')) url = 'https:' + url;
                    
                    // Geçerli video URL kontrolü
                    if (this.isValidVideoURL(url)) {
                        sources.push({
                            url: url,
                            type: this.detectFileType(url),
                            quality: this.extractQuality(html) || 'auto',
                            server: this.extractServerName(finalUrl),
                            referer: finalUrl
                        });
                    }
                }
            }

            // Script tag'lerindeki config objelerini ara
            const $ = load(html);
            $('script').each((idx, el) => {
                const content = $(el).html() || '';
                
                // Player config'leri
                const configMatches = content.match(/(?:var\s+\w*\s*=\s*)?(\{[^{}]*(?:file|src|source|hls)[^{}]*\})/g);
                if (configMatches) {
                    configMatches.forEach(configStr => {
                        try {
                            // Basit JSON parse denemesi
                            const cleanConfig = configStr
                                .replace(/(\w+)\s*:/g, '"$1":')
                                .replace(/'/g, '"');
                            
                            const config = JSON.parse(cleanConfig);
                            
                            ['file', 'src', 'source', 'hls', 'url'].forEach(key => {
                                if (config[key] && this.isValidVideoURL(config[key])) {
                                    sources.push({
                                        url: config[key],
                                        type: this.detectFileType(config[key]),
                                        quality: config.quality || config.label || 'auto',
                                        server: 'embed-config'
                                    });
                                }
                            });
                        } catch (e) {}
                    });
                }
            });

        } catch (error) {
            console.error(`[Dizipal] Single embed error (${embedUrl}):`, error.message);
        }

        return sources;
    }

    /**
     * HTML kaynağından doğrudan video URL'leri çıkar
     */
    extractDirectURLs(html, referer) {
        const sources = [];
        
        // Tüm olası video URL pattern'leri
        const patterns = [
            // Standart m3u8 URL'ler (dizipal formatı dahil)
            /https?:\/\/[a-zA-Z0-9.-]+\.(?:uk-traffic|cloudflare|cdn)\.[a-z]+\/hls?[\/\w-]+\.m3u8[?\w=&.-]*/gi,
            // Genel m3u8
            /\.m3u8[?\w=&.-]*/gi,
            // MP4
            /\.mp4[?\w=&.-]*/gi,
            // Master playlist
            /master\.m3u8[?\w=&.-]*/gi
        ];

        for (const pattern of patterns) {
            let match;
            while ((match = pattern.exec(html)) !== null) {
                let url = match[0];
                
                if (this.isValidVideoURL(url) && !sources.find(s => s.url === url)) {
                    sources.push({
                        url: url,
                        type: this.detectFileType(url),
                        quality: 'direct',
                        server: 'page-source',
                        referer: referer
                    });
                }
            }
        }

        return sources;
    }

    /**
     * Arama fonksiyonu
     */
    async search(query) {
        try {
            const searchUrl = `${this.baseURL}/ara?q=${encodeURIComponent(query)}`;
            const response = await axios.get(searchUrl, {
                headers: this.headers,
                timeout: 15000
            });

            const $ = load(response.data);
            const results = [];

            // Sonuç kartlarını bul
            $('.search-result, .result-item, .dizi-card, .movie-card').each((idx, el) => {
                const $el = $(el);
                const title = $el.find('.title, .name, h2, h3, a').first().text().trim();
                const url = $el.find('a').first().attr('href');
                const image = $el.find('img').attr('src') || $el.find('img').attr('data-src');
                const year = $el.find('.year, .date').text().trim();

                if (title && url) {
                    results.push({
                        title,
                        url: this.resolveURL(url),
                        image: image ? this.resolveURL(image) : null,
                        year: year || null
                    });
                }
            });

            return { success: true, data: results };

        } catch (error) {
            console.error('[Dizipal] Search error:', error.message);
            return { success: false, error: error.message };
        }
    }

    // === YARDIMCI FONKSİYONLAR ===

    resolveURL(url) {
        if (!url) return '';
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
        if (url.startsWith('//')) return 'https:' + url;
        return this.baseURL + (url.startsWith('/') ? '' : '/') + url;
    }

    isValidVideoURL(url) {
        if (!url) return false;
        const validExtensions = ['.m3u8', '.mp4', '.webm', '.mkv'];
        const hasValidExt = validExtensions.some(ext => url.toLowerCase().includes(ext));
        const isValidDomain = url.match(/^https?:\/\/[a-zA-Z0-9.-]+\.[a-z]{2,}/);
        return hasValidExt && isValidDomain;
    }

    detectFileType(url) {
        if (!url) return 'unknown';
        const lower = url.toLowerCase();
        if (lower.includes('.m3u8')) return 'hls';
        if (lower.includes('.mp4')) return 'mp4';
        if (lower.includes('.webm')) return 'webm';
        if (lower.includes('/hls/') || lower.includes('/hls2/')) return 'hls';
        return 'unknown';
    }

    extractQuality(html) {
        const patterns = [
            /(?:quality|label)["']?\s*[:=]\s*["']?(\d{3,4}p|1080p?|720p?|480p?|360p?)["'?]/i,
            /(1080p?|720p?|480p?|360p?)/i
        ];
        for (const p of patterns) {
            const match = html.match(p);
            if (match) return match[1];
        }
        return null;
    }

    extractServerName(url) {
        try {
            const hostname = new URL(url).hostname;
            const serverMap = {
                'uk-traffic': 'CDN-UK',
                'cloudflare': 'CloudFlare',
                'dizipal': 'Main',
                'youtube': 'YouTube',
                'vk.com': 'VK',
                'ok.ru': 'OK'
            };
            for (const [key, name] of Object.entries(serverMap)) {
                if (hostname.includes(key)) return name;
            }
            return hostname.split('.')[0];
        } catch {
            return 'unknown';
        }
    }

    deduplicateSources(sources) {
        const seen = new Set();
        return sources.filter(source => {
            const key = source.url.split('?')[0]; // Query params olmadan kontrol et
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
        }).map((source, idx) => ({
            ...source,
            id: idx + 1,
            priority: this.calculatePriority(source)
        })).sort((a, b) => b.priority - a.priority);
    }

    calculatePriority(source) {
        let score = 0;
        
        // HLS yüksek öncelikli
        if (source.type === 'hls') score += 50;
        if (source.url.includes('master.m3u8')) score += 30;
        
        // CDN önceliği
        if (source.url.includes('uk-traffic')) score += 20;
        if (source.url.includes('cloudflare')) score += 15;
        
        // Kalite bilgisi varsa
        if (source.quality && source.quality !== 'auto') score += 10;
        
        // Server güvenilirliği
        if (source.server === 'CDN-UK' || source.server === 'Main') score += 25;

        return score;
    }

    /**
     * Test fonksiyonu - provider çalışıyor mu kontrol et
     */
    async test() {
        console.log('[Dizipal] Testing provider...');
        
        const testUrls = [
            `${this.baseURL}/bolum/gassal-1-sezon-1-bolum-izle/`,
            `${this.baseURL}/bolum/gibi-1-sezon-1-bolum-izle/`
        ];

        for (const url of testUrls) {
            console.log(`[Dizipal] Testing: ${url}`);
            const result = await this.getVideoSources(url);
            
            if (result.success && result.data.length > 0) {
                console.log(`✅ Success! Found ${result.data.length} sources:`);
                result.data.slice(0, 3).forEach((src, i) => {
                    console.log(`   ${i + 1}. [${src.type}] ${src.quality} - ${src.url.substring(0, 60)}...`);
                });
                return true;
            } else {
                console.log(`❌ Failed: ${result.error || 'No sources found'}`);
            }
        }

        return false;
    }
}

// Export
module.exports = DizipalProvider;

// Eğer doğrudan çalıştırılırsa test et
if (require.main === module) {
    const provider = new DizipalProvider();
    provider.test();
}
